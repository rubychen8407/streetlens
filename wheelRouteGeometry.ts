/** WheelRoute kinds 11/12 publish polygon vertices as lng|lat|lng|lat|...
 * (often with a trailing delimiter). Preserve vertices and precision; only
 * repeat the first vertex when GeoJSON requires an explicit closed ring. */
export function parseWheelRouteGeometry(row: unknown): { type: 'Polygon'; coordinates: number[][][] } | null {
  if (!row || typeof row !== 'object') return null;
  const { kind, location } = row as { kind?: unknown; location?: unknown };
  if (!['11', '12'].includes(String(kind)) || typeof location !== 'string') return null;
  const tokens = location.trim().split('|');
  if (tokens.at(-1) === '') tokens.pop();
  if (tokens.length < 6 || tokens.length % 2 || tokens.some(token => !token.trim())) return null;
  const ring: number[][] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const lng = Number(tokens[i]), lat = Number(tokens[i + 1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    ring.push([lng, lat]);
  }
  if (new Set(ring.map(pair => pair.join('|'))).size < 3) return null;
  const first = ring[0], last = ring.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return { type: 'Polygon', coordinates: [ring] };
}
