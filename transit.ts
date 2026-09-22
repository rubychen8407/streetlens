const TDX_BASE_URL = "https://tdx.transportdata.tw/api/basic/v2";
const TDX_TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

export interface TransitSourceResult {
  stops: any[];
  railStations: any[];
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

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getTdxAccessToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TDX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`TDX token HTTP ${response.status}`);
  }

  const data: any = await response.json();
  if (!data.access_token) throw new Error("TDX token response did not contain access_token");

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 86400) - 60) * 1000,
  };
  return cachedToken.value;
}

async function fetchTdxJson(path: string, signal: AbortSignal): Promise<any> {
  const token = await getTdxAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "StreetLens/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${TDX_BASE_URL}/${path}${path.includes("?") ? "&" : "?"}%24format=JSON`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { signal, headers });
    lastStatus = response.status;
    if (response.ok) return response.json();

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`TDX HTTP ${response.status}`);
    }

    // TDX can rate-limit concurrent CI probes. Back off without inventing data.
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }

  throw new Error(`TDX HTTP ${lastStatus}`);
}

export async function fetchTaiwanTransitData(lat: number, lng: number): Promise<TransitSourceResult> {
  const retrievedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    // TDX is the MOTC national transport data hub. The spatialFilter query
    // returns real Taipei City bus stops from the source dataset.
    const busPath =
      `Bus/Stop/City/Taipei?%24spatialFilter=nearby(StopPosition,${lat},${lng},1500)`;
    const railPath = "Rail/Metro/Station/TRTC";

    const [busData, railData] = await Promise.all([
      fetchTdxJson(busPath, controller.signal),
      fetchTdxJson(railPath, controller.signal),
    ]);

    const busRows = Array.isArray(busData) ? busData : [];
    const railRows = Array.isArray(railData) ? railData : [];

    const stops = busRows
      .map((row: any) => {
        const position = row.StopPosition || {};
        const stopLat = Number(position.PositionLat);
        const stopLng = Number(position.PositionLon);
        if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) return null;
        return {
          id: String(row.StopUID || row.StopID || ""),
          name: row.StopName?.Zh_tw || row.StopName?.En || "",
          lat: stopLat,
          lng: stopLng,
          type: "bus",
          source: "TDX / MOTC (Taipei City bus stops)",
          sourceType: "official",
          retrievedAt,
          distanceMeters: haversineDistanceMeters(lat, lng, stopLat, stopLng),
        };
      })
      .filter(Boolean)
      .filter((stop: any) => stop.distanceMeters <= 1500)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);

    const railStations = railRows
      .map((row: any) => {
        const position = row.StationPosition || {};
        const stationLat = Number(position.PositionLat);
        const stationLng = Number(position.PositionLon);
        if (!Number.isFinite(stationLat) || !Number.isFinite(stationLng)) return null;
        return {
          id: String(row.StationUID || row.StationID || ""),
          name: row.StationName?.Zh_tw || row.StationName?.En || "",
          lat: stationLat,
          lng: stationLng,
          type: "rail",
          source: "TDX / MOTC (Taipei Metro stations)",
          sourceType: "official",
          retrievedAt,
          distanceMeters: haversineDistanceMeters(lat, lng, stationLat, stationLng),
        };
      })
      .filter(Boolean)
      .filter((station: any) => station.distanceMeters <= 1500)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);

    const status = stops.length || railStations.length ? "available" : "empty";

    return {
      stops,
      railStations,
      source: "TDX / MOTC",
      status,
      retrievedAt,
    };
  } catch (error: any) {
    return {
      stops: [],
      railStations: [],
      source: "TDX / MOTC",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
