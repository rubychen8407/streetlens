import type { SavedLocation, StreetSegmentScore } from '../types';
import { streetIdentity } from './streetBaseline';

export type StreetGeometry = Pick<StreetSegmentScore, 'id' | 'name' | 'coords'>;
export const STREET_GEOMETRY_KEY = 'cls_street_geometry_v1';
const MAX_ROADS = 80;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export const GRADE_COLORS = { S: '#c7db85', A: '#91cbb2', B: '#8abbd1', C: '#d8bd87', D: '#cc9aa3' };

export function validStreetGeometry(value: unknown): value is StreetGeometry {
  const road = value as StreetGeometry;
  return !!road && typeof road.id === 'string' && typeof road.name === 'string' && road.name.length <= 200
    && Array.isArray(road.coords) && road.coords.length >= 2 && road.coords.length <= 512
    && road.coords.every(point => Array.isArray(point) && point.length === 2
      && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180);
}
export function mergeStreetGeometry(previous: StreetGeometry[], incoming: unknown[]): StreetGeometry[] {
  const roads = new Map<string, StreetGeometry>();
  for (const road of [...incoming, ...previous]) {
    if (!validStreetGeometry(road)) continue;
    const key = road.name + JSON.stringify(road.coords);
    if (!roads.has(key)) roads.set(key, { id: road.id, name: road.name, coords: road.coords });
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
export function savedStreetGeometry(record: SavedLocation, roads: StreetGeometry[]) {
  const scaleY = 111195, scaleX = scaleY * Math.cos(record.coords.lat * Math.PI / 180);
  const project = (point: [number, number]) => [(point[1] - record.coords.lng) * scaleX, (point[0] - record.coords.lat) * scaleY];
  const unproject = (x: number, y: number): [number, number] => [record.coords.lat + y / scaleY, record.coords.lng + x / scaleX];
  let closest = Infinity, chosen: StreetGeometry | undefined, anchor: [number, number] = [record.coords.lat, record.coords.lng];
  for (const road of roads) {
    if (!validStreetGeometry(road) || streetIdentity(record.city, record.district, road.name)
      !== streetIdentity(record.city, record.district, record.streetName)) continue;
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
