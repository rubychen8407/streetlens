import type { SavedLocation, StreetSegmentScore } from '../types';
import { streetIdentity, distanceMeters } from './streetBaseline';

export type StreetAddress = Pick<SavedLocation,'coords'|'streetName'|'city'|'district'>;
export type StreetGeometry = Pick<StreetSegmentScore, 'id' | 'name' | 'coords'> & {
  matchedIdentity?: string; matchedAnchor?: [number,number];
};
export const STREET_GEOMETRY_KEY = 'cls_street_geometry_v1';
const MAX_ROADS = 200;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export const GRADE_COLORS = { S: '#8b5cf6', A: '#10b981', B: '#0ea5e9', C: '#f59e0b', D: '#ef4444' };
function roadHasIdentity(record: StreetAddress, name: string) {
  const identity=streetIdentity(record.city,record.district,record.streetName);
  return name.normalize('NFKC').split(';').some(alias=>streetIdentity(record.city,record.district,alias)===identity);
}

export function validStreetGeometry(value: unknown): value is StreetGeometry {
  const road = value as StreetGeometry;
  return !!road && typeof road.id === 'string' && typeof road.name === 'string' && road.name.length <= 200
    && Array.isArray(road.coords) && road.coords.length >= 2 && road.coords.length <= 512
    && (road.matchedIdentity === undefined || (typeof road.matchedIdentity === 'string' && road.matchedIdentity.length<=600
      && Array.isArray(road.matchedAnchor) && road.matchedAnchor.length===2
      && road.matchedAnchor.every(Number.isFinite) && Math.abs(road.matchedAnchor[0])<=90 && Math.abs(road.matchedAnchor[1])<=180))
    && road.coords.every(point => Array.isArray(point) && point.length === 2
      && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180);
}
export function mergeStreetGeometry(previous: StreetGeometry[], incoming: unknown[]): StreetGeometry[] {
  const roads = new Map<string, StreetGeometry>();
  const ordered=[...incoming,...previous].filter(validStreetGeometry).sort((a,b)=>Number(!!b.matchedIdentity)-Number(!!a.matchedIdentity));
  for (const road of ordered) {
    if (!validStreetGeometry(road)) continue;
    const key = road.name + (road.matchedIdentity || '') + JSON.stringify(road.coords);
    if (!roads.has(key)) roads.set(key, { id: road.id, name: road.name, coords: road.coords,
      ...(road.matchedIdentity ? {matchedIdentity:road.matchedIdentity,matchedAnchor:road.matchedAnchor} : {}) });
    if (roads.size === MAX_ROADS) break;
  }
  return [...roads.values()];
}
export function readStreetGeometry(storage: Pick<Storage, 'getItem'>, now = Date.now()): StreetGeometry[] {
  try {
    const cached = JSON.parse(storage.getItem(STREET_GEOMETRY_KEY) || 'null');
    if (!cached || !Number.isFinite(cached.updatedAt) || now - cached.updatedAt > MAX_AGE
      || cached.updatedAt > now || !Array.isArray(cached.roads)) return [];
    return mergeStreetGeometry([], cached.roads);
  } catch { return []; }
}

/** Clip an existing road to the observed portion; never extrapolate a road.
 * A local metre projection is sufficient for this bounded 250 m overlay. */
export function savedStreetGeometry(record: StreetAddress, roads: StreetGeometry[]) {
  const scaleY = 111195, scaleX = scaleY * Math.cos(record.coords.lat * Math.PI / 180);
  const project = (point: [number, number]) => [(point[1] - record.coords.lng) * scaleX, (point[0] - record.coords.lat) * scaleY];
  const unproject = (x: number, y: number): [number, number] => [record.coords.lat + y / scaleY, record.coords.lng + x / scaleX];
  let closest = Infinity, chosen: StreetGeometry | undefined, anchor: [number, number] = [record.coords.lat, record.coords.lng];
  for (const road of roads) {
    if (!validStreetGeometry(road)) continue;
    const identity=streetIdentity(record.city,record.district,record.streetName);
    const matched=road.matchedIdentity===identity && road.matchedAnchor
      && distanceMeters(record.coords,{lat:road.matchedAnchor[0],lng:road.matchedAnchor[1]})<=30;
    if (!matched && !roadHasIdentity(record,road.name)) continue;
    for (let i = 1; i < road.coords.length; i++) {
      const [ax, ay] = project(road.coords[i-1]), [bx, by] = project(road.coords[i]);
      const dx = bx-ax, dy = by-ay, length = dx*dx+dy*dy;
      const t = length ? Math.max(0, Math.min(1, -(ax*dx+ay*dy)/length)) : 0;
      const x = ax+t*dx, y = ay+t*dy, distance = Math.hypot(x,y);
      if (distance < closest) { closest = distance; chosen = road; anchor = unproject(x,y); }
    }
  }
  if (!chosen || closest > 60) return { paths: [] as [number, number][][], anchor: [record.coords.lat, record.coords.lng] as [number, number] };
  const paths: [number, number][][] = [];
  let path: [number, number][] = [];
  for (let i = 1; i < chosen.coords.length; i++) {
    const [ax, ay] = project(chosen.coords[i-1]), [bx, by] = project(chosen.coords[i]);
    const dx = bx-ax, dy = by-ay, a = dx*dx+dy*dy, b = 2*(ax*dx+ay*dy), c = ax*ax+ay*ay-250*250;
    const discriminant = b*b-4*a*c;
    if (!a || discriminant < 0) { if (path.length > 1) paths.push(path); path = []; continue; }
    const start = Math.max(0, (-b-Math.sqrt(discriminant))/(2*a));
    const end = Math.min(1, (-b+Math.sqrt(discriminant))/(2*a));
    if (start >= end) { if (path.length > 1) paths.push(path); path = []; continue; }
    if (start > 0 && path.length > 1) { paths.push(path); path = []; }
    if (!path.length) path.push(unproject(ax+start*dx,ay+start*dy));
    path.push(unproject(ax+end*dx,ay+end*dy));
    if (end < 1) { paths.push(path); path = []; }
  }
  if (path.length > 1) paths.push(path);
  return { paths, anchor };
}

function roadDistance(record: StreetAddress, road: StreetGeometry) {
  const sx=111195*Math.cos(record.coords.lat*Math.PI/180),sy=111195;
  let nearest=Infinity;
  for(let i=1;i<road.coords.length;i++) {
    const ax=(road.coords[i-1][1]-record.coords.lng)*sx,ay=(road.coords[i-1][0]-record.coords.lat)*sy;
    const dx=(road.coords[i][1]-road.coords[i-1][1])*sx,dy=(road.coords[i][0]-road.coords[i-1][0])*sy;
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy || 1)));
    nearest=Math.min(nearest,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return nearest;
}
/** Named streets match their actual OSM name. An unnamed lane is usable only
 * at an unambiguous observed position, within 10 m; do not invent a road name. */
export function associateObservedRoad(record: StreetAddress, candidates: StreetGeometry[]): StreetGeometry | null {
  if (!/街|路|巷|弄|\b(street|road|lane|alley|avenue)\b/i.test(record.streetName)) return null;
  const identity=streetIdentity(record.city,record.district,record.streetName);
  const ranked=candidates.filter(validStreetGeometry).map(road=>({road,distance:roadDistance(record,road)}))
    .sort((a,b)=>a.distance-b.distance || a.road.id.localeCompare(b.road.id));
  const named=ranked.find(r=>roadHasIdentity(record,r.road.name) && r.distance<=60);
  const nearest=ranked[0];
  const chosen=named || (nearest && !nearest.road.name.trim() && nearest.distance<=10
    && (!ranked[1] || ranked[1].distance-nearest.distance>=4) ? nearest : undefined);
  return chosen ? {...chosen.road,matchedIdentity:identity,matchedAnchor:[record.coords.lat,record.coords.lng]} : null;
}

// Screen-pixel width follows zoom while preserving the original road centerline.
export function streetHighlightStyle(zoom: number) {
  return { weight: Math.max(1, Math.min(6, 2 ** ((zoom - 15) / 2))), opacity: 0.38 };
}
