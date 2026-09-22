import proj4 from "proj4";

export interface SafetySourceResult {
  accidents: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

const TAIPEI_ACCIDENT_URL =
  "https://data.taipei/api/dataset/2f238b4f-1b27-4085-93e9-d684ef0e2735/resource/83d6d29c-6801-41a2-95c6-47d551646db3/download";

export const SAFETY_RESOURCE_URLS = {
  taipeiFatalInjuryAccidents2025: TAIPEI_ACCIDENT_URL,
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
    x,
    y,
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
  const timeoutId = setTimeout(() => controller.abort(), 12000);

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
