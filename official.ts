import proj4 from "proj4";

export interface OfficialSpatialPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  properties: Record<string, unknown>;
}

export interface OfficialSpatialLine {
  id: string;
  name: string;
  coordinates: Array<[number, number]>;
  properties: Record<string, unknown>;
}

export interface OfficialSpatialArea {
  id: string;
  name: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
}

export interface OfficialCitywideSourceResult {
  points: OfficialSpatialPoint[];
  lines?: OfficialSpatialLine[];
  areas?: OfficialSpatialArea[];
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
  taipeiBusStops: "https://tcgbusfs.blob.core.windows.net/blobbus/TstStop.json",
  taipeiLibraries: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=fb6cc268-e2b8-43a7-86f2-e79702291a2b",
  taipeiPublicToilets: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=9e0e6ad4-b9f9-4810-8551-0cffd1b915b3",
  taipeiParks: "https://parks.gov.taipei/parks/api/",
  taipeiBikeLanes: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=a69988de-6a49-4956-9220-40ebd7c42800",
  wheelRouteFacility11: "https://wheelroute.gov.taipei/wheelrouteApi/api/facility/Get/11",
  wheelRouteFacility12: "https://wheelroute.gov.taipei/wheelrouteApi/api/facility/Get/12",
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


function parseGeometry(value: unknown): OfficialSpatialArea["geometry"] | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return parseGeometry(JSON.parse(value)); } catch { return null; }
  }
  if (typeof value !== "object") return null;
  const candidate = value as any;
  if (candidate.type === "Polygon" || candidate.type === "MultiPolygon") {
    return Array.isArray(candidate.coordinates)
      ? { type: candidate.type, coordinates: candidate.coordinates }
      : null;
  }
  if (candidate.geometry) return parseGeometry(candidate.geometry);
  if (candidate.GEOM4326) return parseGeometry(candidate.GEOM4326);
  if (candidate.geometry4326) return parseGeometry(candidate.geometry4326);
  if (candidate.coordinates && Array.isArray(candidate.coordinates)) {
    const first = candidate.coordinates?.[0]?.[0];
    const firstPair = Array.isArray(first?.[0]) ? first[0] : first;
    if (Array.isArray(firstPair) && firstPair.length >= 2
      && Number.isFinite(Number(firstPair[0]))
      && Number.isFinite(Number(firstPair[1]))) {
      const isMulti = Array.isArray(candidate.coordinates?.[0]?.[0]?.[0]);
      return { type: isMulti ? "MultiPolygon" : "Polygon", coordinates: candidate.coordinates };
    }
  }
  return null;
}

function findSpatialAreas(value: any, depth = 0): Array<{ row: any; geometry: OfficialSpatialArea["geometry"] }> {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) {
    const found: Array<{ row: any; geometry: OfficialSpatialArea["geometry"] }> = [];
    for (const row of value) {
      const geometry = parseGeometry(row);
      if (geometry) found.push({ row, geometry });
      else found.push(...findSpatialAreas(row, depth + 1));
    }
    return found;
  }
  if (typeof value === "object") {
    const geometry = parseGeometry(value);
    if (geometry) return [{ row: value, geometry }];
    return Object.values(value).flatMap((item) => findSpatialAreas(item, depth + 1));
  }
  return [];
}
function findSpatialRows(value: any, depth = 0): any[] {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) {
    const hasSpatialRows = value.some((row) => {
      const lat = row?.latitude ?? row?.lat ?? row?.Latitude ?? row?.緯度;
      const lng = row?.longitude ?? row?.lng ?? row?.lon ?? row?.Longitude ?? row?.經度;
      return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    });
    if (hasSpatialRows) return value;
    for (const item of value) {
      const found = findSpatialRows(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findSpatialRows(item, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

export async function fetchTaipeiBusStops(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Public Transportation Office official bus stops";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiBusStops);
    const rows = findSpatialRows(JSON.parse(text));
    const points: OfficialSpatialPoint[] = rows.map((row: any, index) => {
      const lat = Number(row.latitude ?? row.lat ?? row.Latitude ?? row.緯度);
      const lng = Number(row.longitude ?? row.lng ?? row.lon ?? row.Longitude ?? row.經度);
      const id = String(row.StopUID ?? row.stopUID ?? row.StopID ?? row.stopId ?? row.id ?? row.BSM_BUSSTO ?? `bus-${index}`).trim();
      const name = String(row.StopName?.Zh_tw ?? row.StopName?.zh_tw ?? row.nameZh ?? row.name ?? row.BSM_CHINES ?? id);
      return {
        id,
        name,
        lat,
        lng,
        properties: { stopId: row.StopID ?? row.stopId ?? row.BSM_BUSSTO ?? null },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.id);

    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
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

export async function fetchTaipeiLibraries(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei Public Library official branch and reading room data";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiLibraries);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["閱覽單位", "單位名稱", "館舍名稱", "名稱", "name"]) || `library-${index}`;
      return {
        id: [name, firstValue(row, ["地址", "館舍地址"]), lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          address: firstValue(row, ["地址", "館舍地址"]) || null,
          district: firstValue(row, ["行政區", "行政區域"]) || null,
          zipcode: firstValue(row, ["郵遞區號"]) || null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
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



function parseCoordinateValues(value: string): number[] {
  return value
    .replace(/[()\[\]]/g, " ")
    .split(/[;|\s]+/)
    .flatMap((part) => part.split(","))
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
}

function convertTwd97Path(
  xValue: string,
  yValue: string,
): Array<[number, number]> {
  const xs = parseCoordinateValues(xValue);
  const ys = parseCoordinateValues(yValue);
  const count = Math.min(xs.length, ys.length);
  const coordinates: Array<[number, number]> = [];

  for (let i = 0; i < count; i += 1) {
    const converted = toWgs84(xs[i], ys[i]);
    if (converted) coordinates.push([converted.lng, converted.lat]);
  }
  return coordinates;
}

export async function fetchTaipeiSidewalkAreas(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Transportation Department official sidewalks and marked sidewalks (WheelRoute)";
  try {
    const responses = await Promise.all([
      fetchText(OFFICIAL_SOURCE_URLS.wheelRouteFacility11, 30_000),
      fetchText(OFFICIAL_SOURCE_URLS.wheelRouteFacility12, 30_000),
    ]);
    const areas: OfficialSpatialArea[] = [];
    const seen = new Set<string>();

    responses.forEach(({ text }, responseIndex) => {
      const facilityType = responseIndex === 0 ? 11 : 12;
      let payload: any;
      try { payload = JSON.parse(text); } catch { return; }

      for (const { row, geometry } of findSpatialAreas(payload)) {
        const name = String(
          row?.facilityName
          ?? row?.name
          ?? row?.NAME
          ?? row?.設施名稱
          ?? (facilityType === 11 ? "Sidewalk" : "Marked sidewalk"),
        );
        const id = String(
          row?.ID
          ?? row?.id
          ?? row?.KEYID
          ?? row?.keyid
          ?? (String(facilityType) + "|" + name + "|" + String(areas.length)),
        );
        const uniqueId = String(facilityType) + "|" + id;
        if (seen.has(uniqueId)) continue;
        seen.add(uniqueId);

        const widthCm = Number(row?.width ?? row?.WTH ?? row?.RDLBWT ?? row?.寬度);
        const slopePct = Number(row?.slope ?? row?.SLOPE ?? row?.坡度);

        areas.push({
          id: uniqueId,
          name,
          geometry,
          properties: {
            facilityType,
            widthCm: Number.isFinite(widthCm) ? widthCm : null,
            slopePct: Number.isFinite(slopePct) ? slopePct : null,
            roadId: row?.roadId ?? row?.ROADID ?? row?.RDCODE ?? null,
            lengthM: Number(row?.length ?? row?.LENGTH ?? row?.RDLBLG) || null,
          },
        });
      }
    });

    return {
      points: [],
      areas,
      source,
      status: areas.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: responses.map((response) => response.lastModified).filter(Boolean).sort().pop() || null,
    };
  } catch (error: any) {
    return {
      points: [],
      areas: [],
      source,
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message || String(error),
    };
  }
}
export async function fetchTaipeiBikeLanes(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City official urban bicycle lane GIS data";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiBikeLanes);
    const rows = parseCsv(text);
    const lines: OfficialSpatialLine[] = rows.map((row, index) => {
      const name = firstValue(row, ["路段名稱", "NAME", "name"]) || `bike-lane-${index}`;
      const routeId = firstValue(row, ["自行車道路線編號", "路線編號", "ROUTE_ID"]);
      const coordinates = convertTwd97Path(
        firstValue(row, ["路徑（X）", "路徑(X)", "GIS_X", "X"]),
        firstValue(row, ["路徑（Y）", "路徑(Y)", "GIS_Y", "Y"]),
      );
      return {
        id: [routeId, firstValue(row, ["路段序號", "段序號", "ID"]), name, index].join("|"),
        name,
        coordinates,
        properties: {
          routeId: routeId || null,
          lengthM: numberValue(row, ["自行車道長度（M）", "自行車道長度(M)", "B_LENGTH", "length"]),
          widthM: numberValue(row, ["自行車道寬度（M）", "自行車道寬度(M)", "B_WIDTH", "width"]),
          laneType: firstValue(row, ["自行車道類型", "B_TYPE"]) || null,
          surfaceType: firstValue(row, ["自行車道鋪面類別", "B_SURFACE"]) || null,
          roadWidthM: numberValue(row, ["所屬道路寬度（M）", "所屬道路寬度(M)"]),
          startDescription: firstValue(row, ["自行車道起點描述", "路段起點描述", "SP_DESC"]) || null,
          endDescription: firstValue(row, ["自行車道迄點描述", "路段迄點描述", "EP_DESC"]) || null,
        },
      };
    }).filter((line) => line.coordinates.length >= 2);

    return {
      points: [],
      lines,
      source,
      status: lines.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: lastModified,
    };
  } catch (error: any) {
    return {
      points: [],
      lines: [],
      source,
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message || String(error),
    };
  }
}

export async function fetchTaipeiParks(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Park Administration official park basic data";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiParks);
    const rows = findSpatialRows(JSON.parse(text));
    const points: OfficialSpatialPoint[] = rows.map((row: any, index) => {
      const lat = Number(row.pm_Latitude ?? row.latitude ?? row.lat ?? row.Latitude);
      const lng = Number(row.pm_Longitude ?? row.longitude ?? row.lng ?? row.Longitude);
      const name = String(row.pm_name ?? row.name ?? row.公園名稱 ?? `park-${index}`);
      const id = [
        name,
        lat.toFixed(6),
        lng.toFixed(6),
      ].join("|");
      return {
        id,
        name,
        lat,
        lng,
        properties: {
          district: row.pm_regions ?? row.district ?? null,
          areaM2: Number(row.pm_area) || null,
          managementUnit: row.pm_unit ?? null,
          constructionYear: Number(row.pm_const_year) || null,
          openingStart: row.pm_opening_s ?? null,
          openingEnd: row.pm_opening_e ?? null,
          ecologyPark: row.pm_ecology ?? null,
          parkType: row.pm_type ?? null,
          sports: row.pm_sports ?? null,
          recreation: row.pm_recreation ?? null,
          services: row.pm_service ?? null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: lastModified,
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

export async function fetchTaipeiPublicToilets(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Environmental Protection Department public toilet points";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiPublicToilets);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["公廁名稱", "名稱", "name"]) || `public-toilet-${index}`;
      return {
        id: [firstValue(row, ["公廁編號", "編號", "id"]), name, lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          address: firstValue(row, ["公廁地址", "地址"]) || null,
          district: firstValue(row, ["行政區"]) || null,
          category: firstValue(row, ["公廁類別"]) || null,
          accessibilitySeats: numberValue(row, ["無障礙廁座數"]),
          familySeats: numberValue(row, ["親子廁座數"]),
          topGradeSeats: numberValue(row, ["特優級"]),
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
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
