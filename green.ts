import proj4 from "proj4";

export interface GreenSourceResult {
  streetTrees: any[];
  parkTrees: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

const STREET_TREE_URL = "https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv";
const PARK_TREE_URL = "https://tppkl.blob.core.windows.net/blobfs/TaipeiParkTree.json";

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findCoordinate(value: any): { lat: number; lng: number } | null {
  const geometry = value?.geometry;
  const coordinates = geometry?.coordinates;
  if (geometry?.type === "Point" && Array.isArray(coordinates) && coordinates.length >= 2) {
    const a = Number(coordinates[0]);
    const b = Number(coordinates[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // GeoJSON is normally [lng, lat].
      if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lat: b, lng: a };
    }
  }

  const lat = Number(value?.lat ?? value?.latitude ?? value?.properties?.lat);
  const lng = Number(value?.lng ?? value?.longitude ?? value?.properties?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const x = Number(value?.TWD97X ?? value?.properties?.TWD97X);
  const y = Number(value?.TWD97Y ?? value?.properties?.TWD97Y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const [lngWgs84, latWgs84] = proj4(
      "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs",
      "+proj=longlat +datum=WGS84 +no_defs",
      x,
      y
    );
    if (Number.isFinite(latWgs84) && Number.isFinite(lngWgs84)) {
      return { lat: latWgs84, lng: lngWgs84 };
    }
  }

  return null;
}

function extractRows(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result?.results)) return data.result.results;
  return [];
}

async function fetchDatasetResource(
  resource: "streetTrees" | "parkTrees",
  signal: AbortSignal
): Promise<any[]> {
  const url = resource === "streetTrees" ? STREET_TREE_URL : PARK_TREE_URL;
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json,text/csv,*/*", "User-Agent": "StreetLens/1.0" },
  });
  if (!response.ok) throw new Error(\`\${resource} resource HTTP \${response.status}\`);
  const text = await response.text();
  try {
    return extractRows(JSON.parse(text));
  } catch {
    const lines = text.split(/\\r?\\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  }
}

