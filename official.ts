import proj4 from "proj4";

export interface OfficialSpatialPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  properties: Record<string, unknown>;
}

export interface OfficialCitywideSourceResult {
  points: OfficialSpatialPoint[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  sourceUpdatedAt?: string | null;
  error?: string;
}

export const OFFICIAL_SOURCE_URLS = {
  taipeiYouBike: "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json",
  taipeiClinics: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=3a02af7d-8c33-46c1-8226-c12a11610f6b",
  taipeiHospitals: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=04a3d195-ee97-467a-b066-e471ff99d15d",
  taipeiStreetLights: "https://tppkl.blob.core.windows.net/blobfs/TaipeiLight.json",
};

const USER_AGENT = "StreetLens/1.0";

async function fetchText(url: string, timeoutMs = 30_000): Promise<{ text: string; lastModified: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/csv,*/*",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      text: await response.text(),
      lastModified: response.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])),
  );
}

function firstValue(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value != null && value !== "") return value;
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

function extractArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "records", "results", "features", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function parseDateMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchTaipeiYouBikeData(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Transportation Department YouBike 2.0";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiYouBike);
    const rows = extractArray(JSON.parse(text));
    const points: OfficialSpatialPoint[] = rows
      .map((row: any) => {
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const id = String(row.sno ?? row.stop_id ?? "").trim();
        if (!id) return null;
        return {
          id,
          name: String(row.sna ?? row.stop_name ?? id),
          lat,
          lng,
          properties: {
            capacity: Number(row.Quantity ?? row.quantity) || 0,
            availableRentBikes: Number(row.available_rent_bikes) || 0,
            availableReturnBikes: Number(row.available_return_bikes) || 0,
            active: String(row.act ?? "1") === "1",
            district: row.sarea ?? null,
            address: row.ar ?? null,
            sourceUpdateTime: row.srcUpdateTime ?? row.updateTime ?? null,
            stationUpdateTime: row.mday ?? row.infoTime ?? null,
          },
        };
      })
      .filter(Boolean) as OfficialSpatialPoint[];

    const sourceUpdateMs = rows
      .flatMap((row: any) => [parseDateMs(row.srcUpdateTime), parseDateMs(row.updateTime), parseDateMs(row.mday)])
      .filter((value: number | null): value is number => value != null);
    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: sourceUpdateMs.length
        ? new Date(Math.max(...sourceUpdateMs)).toISOString()
        : lastModified,
    };
  } catch (error: any) {
    return {
      points: [],
      source,
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message || String(error),
    };
  }
}

export async function fetchTaipeiMedicalFacilities(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Health Department medical facilities";
  try {
    const [clinic, hospital] = await Promise.all([
      fetchText(OFFICIAL_SOURCE_URLS.taipeiClinics),
      fetchText(OFFICIAL_SOURCE_URLS.taipeiHospitals),
    ]);
    const rows = [
      ...parseCsv(clinic.text).map((row) => ({ row, kind: "clinic" })),
      ...parseCsv(hospital.text).map((row) => ({ row, kind: "hospital" })),
    ];

    const seen = new Set<string>();
    const points: OfficialSpatialPoint[] = [];
    for (const { row, kind } of rows) {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      if (lat == null || lng == null) continue;
      const name = firstValue(row, ["機構名稱", "醫療機構名稱", "名稱", "name"]) || kind;
      const id = [
        kind,
        firstValue(row, ["縣市別代碼", "行政區域代碼"]),
        name,
        lat.toFixed(6),
        lng.toFixed(6),
      ].join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      points.push({
        id,
        name,
        lat,
        lng,
        properties: {
          kind,
          district: firstValue(row, ["行政區", "行政區域"]) || null,
          address: firstValue(row, ["地址", "機構地址"]) || null,
        },
      });
    }

    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: [clinic.lastModified, hospital.lastModified]
        .filter(Boolean)
        .sort()
        .pop() || null,
    };
  } catch (error: any) {
    return {
      points: [],
      source,
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message || String(error),
    };
  }
}

export async function fetchTaipeiStreetLights(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Public Works Department street light inventory";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiStreetLights);
    const rows = extractArray(JSON.parse(text));
    const points: OfficialSpatialPoint[] = [];

    for (const row of rows) {
      let lat = Number(row.latitude ?? row.lat);
      let lng = Number(row.longitude ?? row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const x = Number(row.TWD97X ?? row.twd97x);
        const y = Number(row.TWD97Y ?? row.twd97y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const converted = toWgs84(x, y);
          if (converted) {
            lat = converted.lat;
            lng = converted.lng;
          }
        }
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const id = String(row.SerialNumber ?? row.serialNumber ?? row.id ?? "").trim();
      if (!id) continue;
      points.push({
        id,
        name: `Street light ${id}`,
        lat,
        lng,
        properties: {
          quantity: Number(row.Quantity ?? row.quantity) || 1,
          lightKind: row.LightKind1 ?? row.lightKind1 ?? null,
          watt: Number(row.LightWatt1 ?? row.lightWatt1) || null,
          height: Number(row.LightHeight ?? row.lightHeight) || null,
          installYear: Number(row.LightYear ?? row.lightYear) || null,
          district: row.Dist ?? row.dist ?? null,
          sourceUpdateDate: row.UpdDate ?? row.updDate ?? null,
        },
      });
    }

    const sourceUpdateMs = rows
      .map((row: any) => parseDateMs(row.UpdDate ?? row.updDate))
      .filter((value: number | null): value is number => value != null);

    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: sourceUpdateMs.length
        ? new Date(Math.max(...sourceUpdateMs)).toISOString()
        : lastModified,
    };
  } catch (error: any) {
    return {
      points: [],
      source,
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message || String(error),
    };
  }
}
