import type { LocationCoord, SavedLocation } from '../types';

export type StreetPlace = { coords: LocationCoord; streetName: string; city?: string; district?: string };
const text = (value: string = '') => value.normalize('NFKC').replace(/台/g, '臺').trim().toLowerCase();
const trim = (value: string) => value.replace(/^[\s,，·/()（）]+|[\s,，·/()（）]+$/g, '');

/** Strip administrative decoration only; keep road sections, lanes and alleys. */
export function streetIdentity(place: StreetPlace) {
  let name = trim(text(place.streetName));
  let city = text(place.city);
  if (city && name.startsWith(city)) name=trim(name.slice(city.length));
  const embeddedCity = !city && name.match(/^([\p{Script=Han}]{1,6}?[縣市])(?!區)(?=.+(?:路|街|大道))/u);
  if (embeddedCity) { city ||= embeddedCity[1]; name = trim(name.slice(embeddedCity[1].length)); }
  for (const token of [text(place.city), text(place.district)]) {
    if (!token) continue;
    if (name.startsWith(token)) name = trim(name.slice(token.length));
    if (name.endsWith(token)) name = trim(name.slice(0, -token.length));
  }
  name = name.replace(/^[\p{Script=Han}]{1,6}(?:區|鄉|鎮)[\s,，·/]*(?=.+(?:路|街|大道))/u, '');
  name = name.replace(/[\s,，·/()（）]+[\p{Script=Han}]{1,6}(?:區|鄉|鎮)[)）]?$/u, '');
  name = trim(name).replace(/\s+/g, ' ');
  const road = /.+(?:路|街|大道)(?:$|.*(?:段|巷|弄|號)$)/u.test(name)
    || /\b(?:street|road|avenue|st|rd|ave)\.?$/i.test(name);
  return { name, city, road };
}

export function placeDistance(a: StreetPlace, b: StreetPlace) {
  const r = Math.PI / 180;
  const h = Math.sin((a.coords.lat - b.coords.lat) * r / 2) ** 2
    + Math.cos(a.coords.lat*r) * Math.cos(b.coords.lat*r) * Math.sin((a.coords.lng-b.coords.lng)*r/2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1,h)));
}

export function sameStreet(a: StreetPlace, b: StreetPlace) {
  const left=streetIdentity(a), right=streetIdentity(b);
  if (left.city && right.city && left.city !== right.city) return false;
  if (left.road && right.road && left.name !== right.name) return false;
  if (a.coords.lat.toFixed(5) === b.coords.lat.toFixed(5) && a.coords.lng.toFixed(5) === b.coords.lng.toFixed(5)) return true;
  return left.road && right.road && left.name === right.name
    && (left.city && left.city === right.city || placeDistance(a,b) <= 35);
}

/** Indexed, display-only grouping. Union never crosses two known city identities. */
export function groupStreetRecords(records: SavedLocation[]): SavedLocation[][] {
  const identities=records.map(streetIdentity);
  const parents=records.map((_,i)=>i), cities=identities.map(identity=>identity.city);
  const names=identities.map(identity=>identity.road ? identity.name : '');
  const root=(i:number):number => { while (parents[i] !== i) { parents[i]=parents[parents[i]]; i=parents[i]; } return i; };
  const join=(a:number,b:number) => {
    a=root(a); b=root(b); if(a===b || cities[a] && cities[b] && cities[a] !== cities[b]
      || names[a] && names[b] && names[a] !== names[b]) return;
    parents[b]=a; cities[a] ||= cities[b]; names[a] ||= names[b];
  };
  const coordinates=new Map<string,number[]>(), named=new Map<string,number>(), nearby=new Map<string,number[]>();
  records.forEach((record,i)=>{
    const identity=identities[i], {lat,lng}=record.coords;
    const coordinate=`${lat.toFixed(5)}:${lng.toFixed(5)}`;
    for(const other of coordinates.get(coordinate)||[]) join(i,other);
    coordinates.set(coordinate,[...new Set([...(coordinates.get(coordinate)||[]).map(root),root(i)])]);
    if(!identity.road) return;
    if(identity.city) {
      const key=JSON.stringify([identity.city,identity.name]);
      const other=named.get(key); if(other!==undefined) join(i,other);
      named.set(key,i);
    }
    // 0.01-degree cells comfortably contain a 35m radius for Taiwan; nearby
    // candidates are distance checked. City-less records never join by name alone.
    const x=Math.floor(lat*100), y=Math.floor(lng*100);
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      const key=JSON.stringify([identity.name,x+dx,y+dy]);
      for(const other of nearby.get(key)||[]) {
        if ((!identity.city || !identities[other].city) && placeDistance(record,records[other])<=35) join(i,other);
      }
    }
    const key=JSON.stringify([identity.name,x,y]); nearby.set(key,[...(nearby.get(key)||[]),i]);
  });
  const groups=new Map<number,SavedLocation[]>();
  records.forEach((record,i)=>{ const key=root(i); const group=groups.get(key)||[]; group.push(record); groups.set(key,group); });
  return [...groups.values()].map(group=>group.sort((a,b)=>b.timestamp-a.timestamp || b.id.localeCompare(a.id)));
}

export function matchesFavoriteKey(place: StreetPlace, key: string) {
  const [latText,lngText,...parts]=key.split(':');
  const lat=Number(latText), lng=Number(lngText);
  if(!latText || !lngText || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return false;
  // Legacy keys carry no city metadata. Borrow context only locally, so the
  // same street name in another city cannot inherit this favorite.
  const candidate={coords:{lat,lng},streetName:parts.join(':'),city:place.city,district:place.district};
  return placeDistance(place,candidate)<=35 && sameStreet(place,candidate);
}

export function favoriteKeysForStreet(place: StreetPlace, keys: string[], records: SavedLocation[]=[]) {
  return keys.filter(key=>matchesFavoriteKey(place,key)
    || records.some(record=>sameStreet(place,record) && matchesFavoriteKey(record,key)));
}
