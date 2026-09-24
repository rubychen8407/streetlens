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
  taipeiStreetLights: "https://tppkl.blob.core.windows.net/blobfs/TaipeiLight.csv",
  taipeiBusStops: "https://tcgbusfs.blob.core.windows.net/blobbus/TstStop.json",
  taipeiLibraries: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=fb6cc268-e2b8-43a7-86f2-e79702291a2b",
  taipeiPublicToilets: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=9e0e6ad4-b9f9-4810-8551-0cffd1b915b3",
  taipeiParks: "https://parks.gov.taipei/parks/api/",
  taipeiBikeLanes: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=a69988de-6a49-4956-9220-40ebd7c42800",
  taipeiMarkets: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=35acfce1-2c4d-4c70-aa75-601cdab2b3f7",
  taipeiCoolingPoints: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=ae7e5986-859d-4294-b289-7c1b2e7c23f1",
  taipeiAed: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=438c61ad-24f6-4e54-a1cc-e2cfe0e7051e",
  taipeiFireHydrants: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=b9f8154d-c627-48a8-b3ef-512ed9cde9e7",
  taipeiOfficialAqi: "https://tpdep.blob.core.windows.net/techdep/tldep_AQI_DAYHour.json",
  taipeiFireStations: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=4486e759-4159-4208-9832-c32300c4e832",
  taipeiAirStations: "https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=bf9f74e7-22d0-4e0f-8e3d-31c04eda22a4",
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
        ? new Date(sourceUpdateMs.reduce((max, value) => Math.max(max, value), 0)).toISOString()
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
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiStreetLights, 60_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = [];

    for (const row of rows) {
      let lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      let lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      if (lat == null || lng == null) {
        const x = numberValue(row, ["TWD97X", "twd97x", "X座標"]);
        const y = numberValue(row, ["TWD97Y", "twd97y", "Y座標"]);
        if (x != null && y != null) {
          const converted = toWgs84(x, y);
          if (converted) {
            lat = converted.lat;
            lng = converted.lng;
          }
        }
      }
      if (lat == null || lng == null) continue;

      const id = firstValue(row, ["SerialNumber", "路燈編號", "id"]);
      if (!id) continue;
      points.push({
        id,
        name: `Street light ${id}`,
        lat,
        lng,
        properties: {
          quantity: numberValue(row, ["Quantity", "燈數量"]) ?? 1,
          lightKind: firstValue(row, ["LightKind1", "燈種"]) || null,
          watt: numberValue(row, ["LightWatt1", "瓦數"]),
          height: numberValue(row, ["LightHeight", "燈桿高"]),
          installYear: numberValue(row, ["LightYear", "使用年"]),
          district: firstValue(row, ["Dist", "行政區"]) || null,
          sourceUpdateDate: firstValue(row, ["UpdDate", "更新日期"]) || null,
        },
      });
    }

    const sourceUpdateMs: number[] = [];
    for (const row of rows) {
      const parsed = parseDateMs(firstValue(row, ["UpdDate", "更新日期"]));
      if (parsed != null) sourceUpdateMs.push(parsed);
    }

    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: sourceUpdateMs.length
        ? new Date(sourceUpdateMs.reduce((max, value) => Math.max(max, value), 0)).toISOString()
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

export async function fetchTaipeiMarkets(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City market basic data";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiMarkets, 30_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["GTag_latitude", "緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["GTag_longitude", "經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["stitle", "市場名稱", "名稱", "name"]) || `market-${index}`;
      return {
        id: [firstValue(row, ["seqno", "序號", "id"]), name, lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          address: firstValue(row, ["xAddress", "地址"]) || null,
          description: firstValue(row, ["xbody", "內容"]) || null,
          createdDate: firstValue(row, ["xcreatedDate", "建立日期"]) || null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
  } catch (error: any) {
    return { points: [], source, status: error?.name === "AbortError" ? "timeout" : "error", retrievedAt, error: error?.message || String(error) };
  }
}

export async function fetchTaipeiCoolingPoints(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Environmental Protection Department cooling points";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiCoolingPoints, 30_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["名稱", "設施名稱", "name"]) || `cooling-point-${index}`;
      return {
        id: [firstValue(row, ["編號", "序號", "id"]), name, lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          facilityType: firstValue(row, ["設施地點（戶外或室內）", "設施地點", "類型"]) || null,
          district: firstValue(row, ["行政區"]) || null,
          address: firstValue(row, ["地址"]) || null,
          openingHours: firstValue(row, ["開放時間"]) || null,
          airConditioning: firstValue(row, ["冷氣"]) || null,
          fan: firstValue(row, ["電風扇"]) || null,
          toilet: firstValue(row, ["廁所"]) || null,
          seating: firstValue(row, ["座位"]) || null,
          drinkingWater: firstValue(row, ["飲水設施"]) || null,
          accessibleSeats: firstValue(row, ["無障礙座位"]) || null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
  } catch (error: any) {
    return { points: [], source, status: error?.name === "AbortError" ? "timeout" : "error", retrievedAt, error: error?.message || String(error) };
  }
}


export async function fetchTaipeiAed(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Health Department AED locations";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiAed, 60_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["場所名稱", "場所", "name"]) || `AED-${index}`;
      return {
        id: [firstValue(row, ["場所名稱", "場所", "name"]), lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          address: firstValue(row, ["場所地址", "地址"]) || null,
          category: firstValue(row, ["場所分類"]) || null,
          type: firstValue(row, ["場所類型"]) || null,
          location: firstValue(row, ["AED放置地點", "AED地點描述"]) || null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
  } catch (error: any) {
    return { points: [], source, status: error?.name === "AbortError" ? "timeout" : "error", retrievedAt, error: error?.message || String(error) };
  }
}

export async function fetchTaipeiFireHydrants(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei Water Department Greater Taipei fire hydrant locations";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiFireHydrants, 60_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["WGS84緯度", "緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["WGS84經度", "經度", "longitude", "Longitude"]);
      const x = numberValue(row, ["97X座標", "TWD97X"]);
      const y = numberValue(row, ["97Y座標", "TWD97Y"]);
      const converted = (lat == null || lng == null) && x != null && y != null ? toWgs84(x, y) : null;
      const finalLat = lat ?? converted?.lat;
      const finalLng = lng ?? converted?.lng;
      const id = firstValue(row, ["WPID", "編號", "序號"]) || `hydrant-${index}`;
      return {
        id,
        name: `Fire hydrant ${id}`,
        lat: finalLat ?? Number.NaN,
        lng: finalLng ?? Number.NaN,
        properties: {
          type: firstValue(row, ["型式", "Type"]) || null,
          area: firstValue(row, ["所在地區", "地區"]) || null,
        },
      };
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    return { points, source, status: points.length ? "available" : "empty", retrievedAt, sourceUpdatedAt: lastModified };
  } catch (error: any) {
    return { points: [], source, status: error?.name === "AbortError" ? "timeout" : "error", retrievedAt, error: error?.message || String(error) };
  }
}


export async function fetchTaipeiOfficialAirQuality(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Environmental Protection Department official air quality monitoring";
  try {
    const [stationResponse, hourlyResponse] = await Promise.all([
      fetchText(OFFICIAL_SOURCE_URLS.taipeiAirStations, 30_000),
      fetchText(OFFICIAL_SOURCE_URLS.taipeiOfficialAqi, 60_000),
    ]);
    const stationMap = new Map<string, { code: string | null; name: string; lat: number; lng: number; address: string | null }>();
    const stationRows = parseCsv(stationResponse.text);

    for (const row of stationRows) {
      const name = firstValue(row, ["station_name_測站名稱", "測站名稱", "station_name", "StationName"]).trim();
      const code = firstValue(row, ["site_id_測站代碼", "測站代碼", "站碼", "station_code", "SiteId"]).trim() || null;
      const lat = numberValue(row, ["latitude_緯度", "緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["longitude_經度", "經度", "longitude", "Longitude"]);
      if (!name || lat == null || lng == null) continue;
      const station = {
        code,
        name,
        lat,
        lng,
        address: firstValue(row, ["station_address_測站地址", "測站地址", "station_address", "Address"]) || null,
      };
      stationMap.set(name, station);
      if (code) stationMap.set(code, station);
    }

    const rows = extractArray(JSON.parse(hourlyResponse.text));
    const latestByStation = new Map<string, {
      stationName: string;
      stationCode: string | null;
      aqi: number | null;
      pm25: number | null;
      publishMs: number;
    }>();

    for (const row of rows) {
      const stationName = firstValue(row, ["站名", "站名代號", "station_name", "StationName"]).trim();
      const stationCode = firstValue(row, ["測站代碼", "站碼", "station_code", "SiteId"]).trim() || null;
      const stationKey = stationCode || stationName;
      if (!stationKey) continue;

      const indicator = firstValue(row, ["指標物", "指標物名稱", "indicator", "ItemName"]).trim();
      const value = numberValue(row, ["指標值", "指標數值", "value", "Value"]);
      const directAqi = numberValue(row, ["AQI", "aqi"]);
      const publishMs = parseDateMs(firstValue(row, ["發布時間", "publishTime", "PublishTime", "時間", "time"])) ?? 0;
      const current = latestByStation.get(stationKey);

      let aqi = current?.aqi ?? null;
      let pm25 = current?.pm25 ?? null;
      if (directAqi != null) aqi = directAqi;
      if (/^AQI$/i.test(indicator) && value != null) aqi = value;
      if (/PM\s*2\.5|PM2\.5/i.test(indicator) && value != null) pm25 = value;

      if (!current || publishMs >= current.publishMs) {
        latestByStation.set(stationKey, { stationName, stationCode, aqi, pm25, publishMs });
      } else if (directAqi != null || /^AQI$/i.test(indicator) || /PM\s*2\.5|PM2\.5/i.test(indicator)) {
        latestByStation.set(stationKey, {
          stationName: current.stationName,
          stationCode: current.stationCode ?? stationCode,
          aqi,
          pm25,
          publishMs: current.publishMs,
        });
      }
    }

    const points: OfficialSpatialPoint[] = [];
    let maxPublishMs: number | null = null;
    for (const [stationKey, latest] of latestByStation) {
      const station = stationMap.get(stationKey)
        ?? (latest.stationCode ? stationMap.get(latest.stationCode) : undefined)
        ?? stationMap.get(latest.stationName);
      if (!station || latest.aqi == null) continue;
      maxPublishMs = maxPublishMs == null ? latest.publishMs : Math.max(maxPublishMs, latest.publishMs);
      points.push({
        id: station.code || latest.stationCode || station.name || latest.stationName,
        name: station.name || latest.stationName,
        lat: station.lat,
        lng: station.lng,
        properties: {
          aqi: latest.aqi,
          pm25: latest.pm25,
          stationName: station.name || latest.stationName,
          stationCode: station.code || latest.stationCode,
          address: station.address,
          publishTime: latest.publishMs ? new Date(latest.publishMs).toISOString() : null,
        },
      });
    }

    return {
      points,
      source,
      status: points.length ? "available" : "empty",
      retrievedAt,
      sourceUpdatedAt: maxPublishMs != null
        ? new Date(maxPublishMs).toISOString()
        : hourlyResponse.lastModified || stationResponse.lastModified,
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


export async function fetchTaipeiFireStations(): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = "Taipei City Fire Department fire station locations";
  try {
    const { text, lastModified } = await fetchText(OFFICIAL_SOURCE_URLS.taipeiFireStations, 60_000);
    const rows = parseCsv(text);
    const points: OfficialSpatialPoint[] = rows.map((row, index) => {
      const lat = numberValue(row, ["緯度", "latitude", "Latitude"]);
      const lng = numberValue(row, ["經度", "longitude", "Longitude"]);
      const name = firstValue(row, ["分隊名稱", "隊名稱", "單位名稱", "name"]) || `fire-station-${index}`;
      return {
        id: [firstValue(row, ["項次編號", "編號", "id"]), name, lat?.toFixed(6) || "", lng?.toFixed(6) || ""].join("|"),
        name,
        lat: lat ?? Number.NaN,
        lng: lng ?? Number.NaN,
        properties: {
          address: firstValue(row, ["地址", "station_address", "Address"]) || null,
          postalCode: firstValue(row, ["郵遞區號", "postal_code"]) || null,
          cityCode: firstValue(row, ["縣市代碼", "city_code"]) || null,
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
