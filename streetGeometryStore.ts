import { dataDb, hashPayload } from './db';
import type { PoolClient } from 'pg';
import { associateObservedRoad, savedStreetGeometry, type StreetAddress, type StreetGeometry } from './src/utils/savedStreetGeometry';
export const ROAD_SOURCE = 'osm_street_geometry';

export const ROAD_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS external_street_geometry (
  feature_id text PRIMARY KEY, name text NOT NULL, highway text NOT NULL, coords jsonb NOT NULL,
  min_lat double precision NOT NULL, max_lat double precision NOT NULL,
  min_lng double precision NOT NULL, max_lng double precision NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_street_geometry_bounds ON external_street_geometry(min_lat,max_lat,min_lng,max_lng);`;
export async function ensureStreetGeometrySchema() { if (dataDb) await dataDb.query(ROAD_SCHEMA_SQL); }

export function decodeRoadPolyline(encoded: string): [number,number][] {
  if (typeof encoded !== 'string' || encoded.length > 8192) throw Error('Invalid road polyline');
  const coords: [number,number][] = [];
  let index=0, lat=0, lng=0;
  const value = () => {
    let result=0, shift=0, b;
    do {
      if (index >= encoded.length || shift > 30) throw Error('Truncated road polyline');
      b=encoded.charCodeAt(index++)-63;
      if (b<0 || b>63) throw Error('Invalid road polyline character');
      result += (b&31)*2**shift; shift+=5;
    } while(b>=32);
    return result%2 ? -(result+1)/2 : result/2;
  };
  while(index<encoded.length) { lat+=value(); lng+=value(); coords.push([lat/1e6,lng/1e6]); if(coords.length>512) throw Error('Road vertex budget exceeded'); }
  return coords;
}
export function validateRoadImport(roads: unknown) {
  if (!Array.isArray(roads) || roads.length<10 || roads.length>60000) throw Error('Invalid or empty road extract');
  const ids=new Set<string>(); let vertices=0;
  const highways=new Set(['primary','secondary','tertiary','unclassified','residential','service','living_street','pedestrian','footway','path']);
  return roads.map(road => {
    if (!road || typeof road.id!=='string' || !/^w\d+:\d+:\d+$/.test(road.id) || ids.has(road.id)
      || typeof road.name!=='string' || road.name.length>200 || !highways.has(road.highway)) throw Error('Invalid road feature');
    ids.add(road.id); const coords=decodeRoadPolyline(road.polyline); vertices+=coords.length;
    if(coords.length<2 || vertices>500000 || coords.some(([lat,lng]) => lat<24.95 || lat>25.22 || lng<121.45 || lng>121.67)
      || !coords.some(([lat,lng])=>lat!==coords[0][0] || lng!==coords[0][1])) throw Error('Invalid road geometry');
    return {id:road.id,name:road.name,highway:road.highway,coords,
      min_lat:Math.min(...coords.map(p=>p[0])),max_lat:Math.max(...coords.map(p=>p[0])),
      min_lng:Math.min(...coords.map(p=>p[1])),max_lng:Math.max(...coords.map(p=>p[1]))};
  });
}
/** Called inside the same import transaction as the static POI inventory. */
export async function persistRoadImport(client: Pick<PoolClient,'query'>, raw: unknown, sourceUpdatedAt: string) {
  if (raw === undefined) return {roadCount:null,roadsChanged:false};
  const roads=validateRoadImport(raw), version=hashPayload(roads);
  const existing=await client.query('SELECT source_version, source_updated_at, payload FROM external_data_snapshots WHERE source_key=$1 AND scope_key=$2',[ROAD_SOURCE,'__citywide__']);
  const prior=existing.rows[0];
  if(prior?.source_updated_at && Date.parse(prior.source_updated_at)>Date.parse(sourceUpdatedAt)) throw Error('Refusing older road extract');
  if(roads.length < (Number(prior?.payload?.roadCount)||0)*0.5) throw Error('Refusing incomplete road extract');
  if(prior?.source_version===version) {
    await client.query('UPDATE external_data_snapshots SET checked_at=NOW(), source_updated_at=$2 WHERE source_key=$1 AND scope_key=$3',[ROAD_SOURCE,sourceUpdatedAt,'__citywide__']);
    return {roadCount:roads.length,roadsChanged:false};
  }
  await client.query('DELETE FROM external_street_geometry');
  await client.query(`INSERT INTO external_street_geometry(feature_id,name,highway,coords,min_lat,max_lat,min_lng,max_lng)
    SELECT r.id,r.name,r.highway,r.coords,r.min_lat,r.max_lat,r.min_lng,r.max_lng FROM jsonb_to_recordset($1::jsonb)
    AS r(id text,name text,highway text,coords jsonb,min_lat float8,max_lat float8,min_lng float8,max_lng float8)`,[JSON.stringify(roads)]);
  const payload={roadCount:roads.length,source:'OpenStreetMap / Geofabrik',attribution:'© OpenStreetMap contributors, ODbL'};
  await client.query(`INSERT INTO external_data_snapshots(source_key,scope_key,payload,content_hash,status,fetched_at,checked_at,source_updated_at,source_version,freshness_method)
    VALUES ($1,'__citywide__',$2::jsonb,$3,'available',NOW(),NOW(),$4,$5,'source_updated_at')
    ON CONFLICT(source_key,scope_key) DO UPDATE SET payload=EXCLUDED.payload,content_hash=EXCLUDED.content_hash,status='available',fetched_at=NOW(),checked_at=NOW(),source_updated_at=EXCLUDED.source_updated_at,source_version=EXCLUDED.source_version`,
    [ROAD_SOURCE,JSON.stringify(payload),hashPayload(payload),sourceUpdatedAt,version]);
  return {roadCount:roads.length,roadsChanged:true};
}
export function validateRoadLocations(value: unknown): StreetAddress[] {
  if(!Array.isArray(value) || value.length<1 || value.length>200) throw Error('Expected 1–200 saved street locations');
  return value.map(location=> {
    if(!location || !Number.isFinite(location.coords?.lat) || !Number.isFinite(location.coords?.lng)
      || Math.abs(location.coords.lat)>90 || Math.abs(location.coords.lng)>180
      || ['streetName','city','district'].some(key=>typeof location[key]!=='string' || location[key].length>200)) throw Error('Invalid saved street location');
    return {coords:location.coords,streetName:location.streetName,city:location.city,district:location.district};
  });
}
export const ROAD_LOOKUP_SQL = `SELECT DISTINCT ON (r.feature_id) r.feature_id AS id,r.name,r.coords
  FROM jsonb_to_recordset($1::jsonb) AS t(lat float8,lng float8)
  CROSS JOIN LATERAL (SELECT * FROM external_street_geometry
    WHERE min_lat<=t.lat+0.0007 AND max_lat>=t.lat-0.0007 AND min_lng<=t.lng+0.0008 AND max_lng>=t.lng-0.0008
    ORDER BY (GREATEST(min_lat-t.lat,0,t.lat-max_lat))^2+(GREATEST(min_lng-t.lng,0,t.lng-max_lng))^2 LIMIT 40) r
  ORDER BY r.feature_id`;
export async function loadSavedStreetGeometry(locations: StreetAddress[]) {
  if(!dataDb) return {roads:[],dataStatus:'database_required'};
  const manifest=await dataDb.query('SELECT source_updated_at,source_version,payload FROM external_data_snapshots WHERE source_key=$1 AND scope_key=$2',[ROAD_SOURCE,'__citywide__']);
  const metadata=manifest.rows[0];
  if(!metadata || Date.now()-Date.parse(metadata.source_updated_at)>35*86400000) return {roads:[],dataStatus:'pending_refresh'};
  const rows=await dataDb.query(ROAD_LOOKUP_SQL,[JSON.stringify(locations.map(l=>({lat:l.coords.lat,lng:l.coords.lng})))]);
  const roads: StreetGeometry[]=[];
  for(const location of locations) {
    const matched=associateObservedRoad(location,rows.rows);
    if(!matched) continue;
    const geometry=savedStreetGeometry(location,[matched]);
    geometry.paths.forEach((coords,i)=>roads.push({...matched,id:matched.id+':'+i,coords}));
  }
  return {roads,dataStatus:'cached',sourceUpdatedAt:metadata.source_updated_at,sourceVersion:metadata.source_version};
}
