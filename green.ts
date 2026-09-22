import proj4 from "proj4";

export interface GreenSourceResult {
  streetTrees: any[];
  parkTrees: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

const DATA_TAIPEI_URL =
  "https://data.taipei/api/v1/dataset/7a49d00c-a5ff-4a6b-be9e-aaa6dc1ff7e8";

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
  const response = await fetch(DATA_TAIPEI_URL, {
    signal,
    headers: { Accept: "application/json", "User-Agent": "StreetLens/1.0" },
  });
  if (!response.ok) throw new Error(`data.taipei metadata HTTP ${response.status}`);
  const metadata: any = await response.json();

  const resources = extractRows(metadata?.resources ?? metadata?.result?.resources);
  const match = resources.find((item: any) => {
    const name = String(item.name ?? item.title ?? item.description ?? "");
    return resource === "streetTrees"
      ? /行道樹.*CSV|行道樹資料/i.test(name)
      : /公園樹木.*(JSON|CSV)/i.test(name);
  });

  const url = match?.url ?? match?.download_url ?? match?.resource_url;
  if (!url) throw new Error(`No ${resource} resource URL in data.taipei metadata`);

  const dataResponse = await fetch(url, {
    signal,
    headers: { Accept: "application/json,text/csv,*/*", "User-Agent": "StreetLens/1.0" },
  });
  if (!dataResponse.ok) throw new Error(`${resource} resource HTTP ${dataResponse.status}`);

  const text = await dataResponse.text();
  try {
    return extractRows(JSON.parse(text));
  } catch {
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(","));
  }
}

export async function fetchTaipeiGreenData(lat: number, lng: number): Promise<GreenSourceResult> {
  const retrievedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const [streetRows, parkRows] = await Promise.all([
      fetchDatasetResource("streetTrees", controller.signal),
      fetchDatasetResource("parkTrees", controller.signal),
    ]);

    const streetTrees = streetRows
      .map((row: any) => {
        const coordinate = findCoordinate(row);
        return coordinate
          ? {
              ...coordinate,
              treeId: row.TreeID ?? row.properties?.TreeID ?? null,
              treeType: row.TreeType ?? row.properties?.TreeType ?? null,
              source: "Taipei City Parks and Street Trees dataset",
              sourceType: "official",
              retrievedAt,
              distanceMeters: haversineDistanceMeters(lat, lng, coordinate.lat, coordinate.lng),
            }
          : null;
      })
      .filter(Boolean)
      .filter((tree: any) => tree.distanceMeters <= 800)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);

    const parkTrees = parkRows
      .map((row: any) => {
        const coordinate = findCoordinate(row);
        return coordinate
          ? {
              ...coordinate,
              treeId: row.TreeID ?? row.properties?.TreeID ?? null,
              parkName: row.ParkName ?? row.properties?.ParkName ?? null,
              source: "Taipei City Parks and Street Trees dataset",
              sourceType: "official",
              retrievedAt,
              distanceMeters: haversineDistanceMeters(lat, lng, coordinate.lat, coordinate.lng),
            }
          : null;
      })
      .filter(Boolean)
      .filter((tree: any) => tree.distanceMeters <= 800)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);

    return {
      streetTrees,
      parkTrees,
      source: "Taipei City Parks and Street Trees dataset",
      status: streetTrees.length || parkTrees.length ? "available" : "empty",
      retrievedAt,
    };
  } catch (error: any) {
    return {
      streetTrees: [],
      parkTrees: [],
      source: "Taipei City Parks and Street Trees dataset",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
