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

export const GREEN_RESOURCE_URLS = {
  streetTrees: STREET_TREE_URL,
  parkTrees: PARK_TREE_URL,
};

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
      [x, y]
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

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()]))
  );
}

interface DatasetRowsResult {
  format: "json" | "csv";
  rowCount: number;
  coordinateRowCount: number;
  coordinateColumns: string[];
}

function processNearbyRows(
  rows: any[],
  lat: number,
  lng: number,
  radiusMeters: number,
): { nearbyRows: any[]; coordinateRowCount: number } {
  const nearbyRows: any[] = [];
  let coordinateRowCount = 0;

  // Keep only a small representation of nearby observations. The full source
  // rows are not needed for scoring and keeping copies of every source row
  // caused excessive memory pressure on the free hosting instance.
  for (const row of rows) {
    const coordinate = findCoordinate(row);
    if (!coordinate) continue;
    coordinateRowCount += 1;

    const distanceMeters = haversineDistanceMeters(
      lat,
      lng,
      coordinate.lat,
      coordinate.lng,
    );
    if (distanceMeters <= radiusMeters) {
      nearbyRows.push({
        lat: coordinate.lat,
        lng: coordinate.lng,
        distanceMeters,
      });
    }
  }

  nearbyRows.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { nearbyRows, coordinateRowCount };
}

async function fetchDatasetResource(
  resource: "streetTrees" | "parkTrees",
  lat: number,
  lng: number,
  radiusMeters: number,
  signal: AbortSignal,
): Promise<DatasetRowsResult & { nearbyRows: any[] }> {
  const url = resource === "streetTrees" ? STREET_TREE_URL : PARK_TREE_URL;
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json,text/csv,*/*", "User-Agent": "StreetLens/1.0" },
  });
  if (!response.ok) throw new Error(`${resource} resource HTTP ${response.status}`);
  const text = await response.text();

  let rows: any[];
  let format: "json" | "csv";
  try {
    rows = extractRows(JSON.parse(text));
    format = "json";
  } catch {
    rows = parseCsv(text);
    format = "csv";
  }

  const coordinateColumns = rows.length
    ? Object.keys(rows[0]).filter((key) => /^(TWD97X|TWD97Y|lat|latitude|lng|longitude)$/i.test(key))
    : [];
  const processed = processNearbyRows(rows, lat, lng, radiusMeters);

  return {
    format,
    rowCount: rows.length,
    coordinateRowCount: processed.coordinateRowCount,
    coordinateColumns,
    nearbyRows: processed.nearbyRows,
  };
}

export async function fetchTaipeiGreenData(
  lat: number,
  lng: number,
  radiusMeters = 800,
): Promise<GreenSourceResult> {
  const retrievedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    // Process the two large official datasets sequentially. This keeps the peak
    // memory footprint much lower than downloading/parsing both at once.
    const results: Record<string, DatasetRowsResult & { nearbyRows: any[] } | null> = {
      streetTrees: null,
      parkTrees: null,
    };
    const errors: string[] = [];

    for (const resource of ["streetTrees", "parkTrees"] as const) {
      try {
        results[resource] = await fetchDatasetResource(
          resource,
          lat,
          lng,
          radiusMeters,
          controller.signal,
        );
      } catch (error: any) {
        errors.push(`${resource}: ${error?.name === "AbortError" ? "timeout" : error?.message || String(error)}`);
      }
    }

    const streetResult = results.streetTrees;
    const parkResult = results.parkTrees;
    const streetTrees = streetResult?.nearbyRows ?? [];
    const parkTrees = parkResult?.nearbyRows ?? [];
    const hasSuccessfulResource = Boolean(streetResult || parkResult);

    console.log(JSON.stringify({
      greenParser: {
        streetTrees: streetResult
          ? {
              format: streetResult.format,
              rowCount: streetResult.rowCount,
              coordinateRowCount: streetResult.coordinateRowCount,
              coordinateColumns: streetResult.coordinateColumns,
              nearbyCount: streetTrees.length,
            }
          : null,
        parkTrees: parkResult
          ? {
              format: parkResult.format,
              rowCount: parkResult.rowCount,
              coordinateRowCount: parkResult.coordinateRowCount,
              coordinateColumns: parkResult.coordinateColumns,
              nearbyCount: parkTrees.length,
            }
          : null,
      },
    }, null, 2));

    return {
      streetTrees,
      parkTrees,
      source: "Taipei City Parks and Street Trees dataset",
      status: hasSuccessfulResource && (streetTrees.length || parkTrees.length)
        ? "available"
        : hasSuccessfulResource
          ? "empty"
          : controller.signal.aborted
            ? "timeout"
            : "error",
      retrievedAt,
      error: errors.length ? errors.join("; ") : undefined,
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
