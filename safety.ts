import proj4 from "proj4";

export interface SafetySourceResult {
  accidents: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

const TAIPEI_RESIDENTIAL_THEFT_URL =
  "https://data.taipei/api/dataset/68785231-d6c5-47a1-b001-77eec70bec02/resource/93d9bc2d-af08-4db7-a56b-9f0a49226fa3/download";

// Current official 2025 accident point dataset. The older resource ID was
// retired/replaced by Taipei Data Platform after the 2025 dataset rollover.
const TAIPEI_ACCIDENT_URL =
  "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=d4aaaaa6-d03e-4539-945b-cdbd9387007d";

export const SAFETY_RESOURCE_URLS = {
  taipeiTrafficAccidentPoints2025: TAIPEI_ACCIDENT_URL,
  taipeiResidentialTheft: TAIPEI_RESIDENTIAL_THEFT_URL,
};



export interface CrimeSourceResult {
  thefts: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

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

function firstValue(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    if (row[name] != null && row[name] !== "") return row[name];
  }
  return "";
}

function numberValue(row: Record<string, string>, names: string[]): number | null {
  const raw = firstValue(row, names).replace(/,/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function toWgs84(x: number, y: number): { lat: number; lng: number } | null {
  const [lng, lat] = proj4(
    "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs",
    "+proj=longlat +datum=WGS84 +no_defs",
    [x, y],
  );
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function parseAccidentRow(row: Record<string, string>, retrievedAt: string): any | null {
  let lat = numberValue(row, ["緯度", "Latitude", "latitude"]);
  let lng = numberValue(row, ["經度", "Longitude", "longitude"]);

  if (lat == null || lng == null) {
    const x = numberValue(row, ["座標-X", "座標X", "X", "x"]);
    const y = numberValue(row, ["座標-Y", "座標Y", "Y", "y"]);
    if (x != null && y != null) {
      const converted = toWgs84(x, y);
      if (converted) {
        lat = converted.lat;
        lng = converted.lng;
      }
    }
  }

  if (lat == null || lng == null) return null;
  if (lat < 24 || lat > 26 || lng < 120 || lng > 122) return null;

  const year = firstValue(row, ["發生年度", "年度"]);
  const month = firstValue(row, ["發生月"]);
  const day = firstValue(row, ["發生日"]);
  const hour = firstValue(row, ["發生時-Hours", "發生時"]);
  const minute = firstValue(row, ["發生分"]);
  const location = firstValue(row, ["肇事地點", "發生地點"]);
  const district = firstValue(row, ["區序"]);
  const type = firstValue(row, ["處理別", "事故類別名稱", "事故類別"]);

  // The source is person/involved-party detail data rather than a guaranteed
  // one-row-per-accident table. Build a deterministic event key so multiple
  // involved parties in one accident are not counted as separate accidents.
  const eventKey = [
    year, month, day, hour, minute, district, location,
    lat.toFixed(6), lng.toFixed(6),
  ].join("|");

  return {
    eventKey,
    lat,
    lng,
    type,
    source: "Taipei City Police Department traffic accident data (2025)",
    sourceType: "official",
    retrievedAt,
  };
}

export async function fetchTaipeiSafetyData(
  lat: number,
  lng: number,
  radiusMeters = 500,
): Promise<SafetySourceResult> {
  const retrievedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(TAIPEI_ACCIDENT_URL, {
      signal: controller.signal,
      headers: { Accept: "text/csv,*/*", "User-Agent": "StreetLens/1.0" },
    });
    if (!response.ok) throw new Error(`Taipei accident resource HTTP ${response.status}`);

    const text = await response.text();
    const rows = parseCsv(text);
    const parsed = rows
      .map((row) => parseAccidentRow(row, retrievedAt))
      .filter(Boolean) as any[];

    const unique = new Map<string, any>();
    for (const accident of parsed) {
      if (!unique.has(accident.eventKey)) unique.set(accident.eventKey, accident);
    }

    const accidents = [...unique.values()]
      .map((accident) => ({
        ...accident,
        distanceMeters: haversineDistanceMeters(lat, lng, accident.lat, accident.lng),
      }))
      .filter((accident) => accident.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {
      accidents,
      source: "Taipei City Police Department traffic accident data (2025)",
      status: accidents.length ? "available" : "empty",
      retrievedAt,
    };
  } catch (error: any) {
    return {
      accidents: [],
      source: "Taipei City Police Department traffic accident data (2025)",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}


export async function fetchTaipeiResidentialTheftData(
  lat: number,
  lng: number,
  radiusMeters = 500,
): Promise<CrimeSourceResult> {
  const retrievedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(TAIPEI_RESIDENTIAL_THEFT_URL, {
      signal: controller.signal,
      headers: { Accept: "text/csv,*/*", "User-Agent": "StreetLens/1.0" },
    });
    if (!response.ok) throw new Error(`Taipei residential theft HTTP ${response.status}`);
    const text = await response.text();
    const rows = parseCsv(text);
    const thefts = rows.map((row) => {
      const latValue = numberValue(row, ["緯度", "Latitude", "latitude"]);
      const lngValue = numberValue(row, ["經度", "Longitude", "longitude"]);
      return {
        id: firstValue(row, ["編號", "ID", "id"]),
        type: firstValue(row, ["案類", "案件類別"]),
        date: firstValue(row, ["發生日期", "日期"]),
        period: firstValue(row, ["發生時段", "時段"]),
        location: firstValue(row, ["發生地點", "地點"]),
        lat: latValue,
        lng: lngValue,
        source: "Taipei City Police Department residential theft point data",
        retrievedAt,
      };
    }).filter((x) => x.lat != null && x.lng != null)
      .map((x) => ({ ...x, distanceMeters: haversineDistanceMeters(lat, lng, x.lat as number, x.lng as number) }))
      .filter((x) => x.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    return {
      thefts,
      source: "Taipei City Police Department residential theft point data",
      status: thefts.length ? "available" : "empty",
      retrievedAt,
    };
  } catch (error: any) {
    return {
      thefts: [],
      source: "Taipei City Police Department residential theft point data",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}


export interface FloodHazardCell {
  scenarioMmPerHour: 78.8 | 100 | 130;
  depthCm: number | null;
  distanceMeters: number;
  source: string;
  sourceType: "official_model";
  retrievedAt: string;
}

export interface FloodSourceResult {
  riskCells: FloodHazardCell[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

const FLOOD_RESOURCES = [
  { scenario: 78.8 as const, url: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=173adcbe-0f2e-4941-b2bc-127c09db0391" },
  { scenario: 100 as const, url: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=4b14c3a0-fcf2-48d4-9c93-e27784cae29d" },
  { scenario: 130 as const, url: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=2954e8d4-cb67-40c9-8ab8-019ad10b758e" },
];

export const FLOOD_RESOURCE_URLS = Object.fromEntries(
  FLOOD_RESOURCES.map((item) => [`taipeiFlood${String(item.scenario).replace(".", "_")}mmh`, item.url]),
);

type Polygon = [number, number][];

const floodCache = new Map<string, { expiresAt: number; polygons: { scenario: FloodHazardCell["scenarioMmPerHour"]; polygon: Polygon; depthCm: number | null }[] }>();

function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function parseDepthCm(placemark: string): number | null {
  const match = placemark.match(/<SimpleData[^>]*name=["']depth["'][^>]*>([^<]+)</i)
    || placemark.match(/<Data[^>]*name=["']depth["'][^>]*>\s*<value>([^<]+)</i);
  if (!match) return null;
  const value = Number(match[1].trim());
  return Number.isFinite(value) ? value : null;
}

function parsePolygons(kml: string, scenario: FloodHazardCell["scenarioMmPerHour"]) {
  const polygons: { scenario: FloodHazardCell["scenarioMmPerHour"]; polygon: Polygon; depthCm: number | null }[] = [];
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || [];
  for (const placemark of placemarks) {
    const depthCm = parseDepthCm(placemark);
    const coordinateBlocks = placemark.match(/<coordinates[^>]*>[\s\S]*?<\/coordinates>/gi) || [];
    for (const block of coordinateBlocks) {
      const raw = block.replace(/<\/?coordinates[^>]*>/gi, "").trim();
      const polygon = raw.split(/\s+/).map((token) => {
        const [lng, lat] = token.split(",").map(Number);
        return [lng, lat] as [number, number];
      }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
      if (polygon.length >= 3) polygons.push({ scenario, polygon, depthCm });
    }
  }
  return polygons;
}

async function loadFloodPolygons(): Promise<{ scenario: FloodHazardCell["scenarioMmPerHour"]; polygon: Polygon; depthCm: number | null }[]> {
  const cached = floodCache.get("all");
  if (cached && cached.expiresAt > Date.now()) return cached.polygons;

  const settled = await Promise.allSettled(FLOOD_RESOURCES.map(async (resource) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(resource.url, {
        signal: controller.signal,
        headers: { Accept: "application/vnd.google-earth.kml+xml,application/xml,text/xml,*/*", "User-Agent": "StreetLens/1.0" },
      });
      if (!response.ok) throw new Error(`Taipei flood KML HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("Taipei flood KML returned empty content");
      return parsePolygons(text, resource.scenario);
    } finally {
      clearTimeout(timeoutId);
    }
  }));
  const polygons = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!polygons.length) throw new Error("No flood polygons were parsed from official KML resources");
  floodCache.set("all", { expiresAt: Date.now() + 60 * 60 * 1000, polygons });
  return polygons;
}

export async function fetchTaipeiFloodHazardData(
  lat: number,
  lng: number,
): Promise<FloodSourceResult> {
  const retrievedAt = new Date().toISOString();
  try {
    const polygons = await loadFloodPolygons();
    const matches = polygons
      .filter((item) => pointInPolygon(lng, lat, item.polygon))
      .map((item) => ({
        scenarioMmPerHour: item.scenario,
        depthCm: item.depthCm,
        distanceMeters: 0,
        source: "Taipei City official rainfall inundation simulation (112 revision)",
        sourceType: "official_model" as const,
        retrievedAt,
      }))
      .sort((a, b) => a.scenarioMmPerHour - b.scenarioMmPerHour);

    return {
      riskCells: matches,
      source: "Taipei City official rainfall inundation simulation (112 revision)",
      status: matches.length ? "available" : "empty",
      retrievedAt,
    };
  } catch (error: any) {
    return {
      riskCells: [],
      source: "Taipei City official rainfall inundation simulation (112 revision)",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  }
}
