import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { applyFieldObservationAdjustment, calculateAssessment, C1SafetyMetrics, C4GreenMetrics } from "./scoring";
import { fetchTaiwanTransitData as fetchTdxTransitData } from "./transit";
import { fetchTaipeiGreenData, fetchTaipeiGreenDataForTargets, GREEN_RESOURCE_URLS } from "./green";
import { fetchTaipeiSafetyData, fetchTaipeiSafetyDataForTargets, fetchTaipeiFloodHazardData, fetchTaipeiFloodHazardDataForTargets, FLOOD_RESOURCE_URLS, SAFETY_RESOURCE_URLS } from "./safety";
import { ensureDataCacheSchema, getCachedSnapshot, getNearestCachedSnapshot, getC5CommunityReference, getDistanceAndAirQualityReferences, getGreenDensityReference, getNearestCommunityDistanceReference, getNearestParkDistanceReference, getNearestCommunityCulturalDistanceReference, getPoiDensityReference, getSafetyReference, listActiveAssessmentTargets, markSnapshotChecked, registerAssessmentTarget, saveSnapshot } from "./db";
import { ensureAssessmentSchema, getAssessmentPhoto, getAssessmentSession, deleteAssessmentSession, listAssessmentSessions, saveAssessmentPhoto, saveAssessmentSession } from "./assessmentDb";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

// Assessment data is persisted first. User requests never crawl scoring sources.
const schemaReady = Promise.all([ensureDataCacheSchema(), ensureAssessmentSchema()]);
schemaReady.catch((error) => console.error("Data schema initialization failed:", error));
const DATA_REFRESH_TOKEN = process.env.STREETLENS_REFRESH_TOKEN || "";

// Lazy-initialized Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }
  return geminiClient;
}

// Resilient Gemini generation supporting fast modern models with automatic fallback
async function generateGeminiContentWithFallback(
  ai: GoogleGenAI,
  contents: string,
  responseMimeType?: string
): Promise<string> {
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ];
  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: responseMimeType ? { responseMimeType } : undefined,
      });
      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      lastError = err;
      // Try next available model in candidate list
      continue;
    }
  }

  throw lastError || new Error("All candidate Gemini models failed");
}

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function waitForPersistenceSchema() {
  await schemaReady;
}

app.get("/api/assessments", async (req: Request, res: Response) => {
  try {
    await waitForPersistenceSchema();
    const workspaceId = req.query.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
    const records = await listAssessmentSessions(workspaceId, req.query.limit);
    return res.json(records);
  } catch (error: any) {
    console.error("Assessment history error:", error);
    return res.status(503).json({ error: error?.message || "Assessment history unavailable" });
  }
});

app.post("/api/assessments", async (req: Request, res: Response) => {
  try {
    await waitForPersistenceSchema();
    const record = await saveAssessmentSession({
      workspaceId: req.body?.workspaceId,
      assessment: req.body?.assessment,
      evidence: req.body?.evidence,
    });
    return res.status(201).json(record);
  } catch (error: any) {
    const message = error?.message || "Unable to persist assessment";
    console.error("Assessment persistence error:", error);
    return res.status(400).json({ error: message });
  }
});

app.delete("/api/assessments/:id", async (req: Request, res: Response) => {
  try {
    await waitForPersistenceSchema();
    const deleted = await deleteAssessmentSession(req.query.workspaceId, req.params.id);
    return res.status(deleted ? 204 : 404).send();
  } catch (error: any) {
    console.error("Assessment delete error:", error);
    return res.status(400).json({ error: error?.message || "Unable to delete assessment" });
  }
});

app.put(
  "/api/assessments/:id/evidence/:evidenceId/photo",
  express.raw({ type: ["image/*", "application/octet-stream"], limit: "5mb" }),
  async (req: Request, res: Response) => {
    try {
      await waitForPersistenceSchema();
      await saveAssessmentPhoto(
        req.query.workspaceId,
        req.params.id,
        req.params.evidenceId,
        req.body as Buffer,
        req.headers["content-type"],
      );
      return res.status(204).send();
    } catch (error: any) {
      console.error("Assessment photo upload error:", error);
      return res.status(400).json({ error: error?.message || "Unable to store assessment photo" });
    }
  },
);

app.get("/api/assessments/:id/evidence/:evidenceId/photo", async (req: Request, res: Response) => {
  try {
    await waitForPersistenceSchema();
    const photo = await getAssessmentPhoto(req.query.workspaceId, req.params.id, req.params.evidenceId);
    if (!photo) return res.status(404).json({ error: "Evidence photo not found" });
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(photo.body);
  } catch (error: any) {
    console.error("Assessment photo load error:", error);
    return res.status(400).json({ error: error?.message || "Unable to load assessment photo" });
  }
});

// ---------------------------------------------------------------------------
// Geocoding & Maps: Google Maps Platform API (Geocoding, Places New, Routes, Roads)
// Using authorized provisioned key for high accuracy Taiwan spatial infrastructure.
// ---------------------------------------------------------------------------
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// Small in-memory cache for reverse-geocode lookups so dragging the pin
// around the same spot doesn't re-hit the geocoding API every time.
const REVERSE_GEOCODE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const reverseGeocodeCache = new Map<string, { data: any; ts: number }>();

function reverseGeocodeCacheKey(lat: string, lon: string): string {
  // Round to ~5 decimal places (~1m) so nearby drags reuse the same entry.
  return `${parseFloat(lat).toFixed(5)},${parseFloat(lon).toFixed(5)}`;
}

function getFromReverseGeocodeCache(key: string): any | null {
  const entry = reverseGeocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > REVERSE_GEOCODE_CACHE_TTL_MS) {
    reverseGeocodeCache.delete(key);
    return null;
  }
  return entry.data;
}

function setInReverseGeocodeCache(key: string, data: any) {
  // Basic size cap to avoid unbounded growth on a long-running server.
  if (reverseGeocodeCache.size > 1000) {
    reverseGeocodeCache.clear();
  }
  reverseGeocodeCache.set(key, { data, ts: Date.now() });
}

// Converts a Google Geocoding API `address_components` array into the same
// shape the frontend already expects from Nominatim (`data.address.road`,
// `.suburb`, `.city`, etc.), so App.tsx / FloatingControls.tsx don't need to
// change at all.
function mapGoogleAddressComponents(components: any[] = []) {
  const get = (type: string) =>
    components.find((c) => Array.isArray(c.types) && c.types.includes(type))?.long_name;

  return {
    road: get("route"),
    pedestrian: get("route"),
    neighbourhood: get("neighborhood") || get("sublocality_level_2"),
    suburb: get("sublocality_level_1") || get("sublocality"),
    district: get("sublocality_level_1") || get("sublocality"),
    town: get("locality") || get("administrative_area_level_3"),
    city: get("administrative_area_level_1"),
    county: get("administrative_area_level_2"),
  };
}

// Geocoding proxy — Google Maps first, Nominatim (OpenStreetMap) fallback
app.get("/api/geocode", async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    if (GOOGLE_MAPS_API_KEY) {
      try {
        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          query
        )}&language=zh-TW&region=tw&key=${GOOGLE_MAPS_API_KEY}`;
        const gRes = await fetch(gUrl);
        const gData: any = await gRes.json();

        if (gData.status === "OK" && Array.isArray(gData.results) && gData.results.length > 0) {
          const mapped = gData.results.slice(0, 5).map((r: any) => ({
            lat: String(r.geometry.location.lat),
            lon: String(r.geometry.location.lng),
            display_name: r.formatted_address,
            name: r.formatted_address.split(",")[0],
            address: mapGoogleAddressComponents(r.address_components),
          }));
          return res.json(mapped);
        }

        console.warn("Google geocode returned non-OK status, falling back to Nominatim:", gData.status);
      } catch (gErr) {
        console.warn("Google geocode request failed, falling back to Nominatim:", gErr);
      }
    }

    // Fallback: Nominatim (OpenStreetMap) — free, no key required
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}&addressdetails=1&limit=5`,
      {
        headers: {
          "User-Agent": "LivabilityScoutApp/2.0 (contact@aistudio.internal)",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.statusText}`);
    }
    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    console.error("Geocode error:", error);
    return res.status(500).json({ error: error.message || "Failed to geocode" });
  }
});

// Reverse Geocoding — Google Maps first, Nominatim (OpenStreetMap) fallback
app.get("/api/reverse-geocode", async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat as string;
    const lon = req.query.lon as string;
    if (!lat || !lon) {
      return res.status(400).json({ error: "Missing lat/lon" });
    }

    const cacheKey = reverseGeocodeCacheKey(lat, lon);
    const cached = getFromReverseGeocodeCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (GOOGLE_MAPS_API_KEY) {
      try {
        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
        const gRes = await fetch(gUrl);
        const gData: any = await gRes.json();

        if (gData.status === "OK" && Array.isArray(gData.results) && gData.results.length > 0) {
          const best = gData.results[0];
          const result = {
            display_name: best.formatted_address,
            address: mapGoogleAddressComponents(best.address_components),
          };
          setInReverseGeocodeCache(cacheKey, result);
          return res.json(result);
        }

        console.warn("Google reverse geocode returned non-OK status, falling back to Nominatim:", gData.status);
      } catch (gErr) {
        console.warn("Google reverse geocode request failed, falling back to Nominatim:", gErr);
      }
    }

    // Fallback: Nominatim (OpenStreetMap) — free, no key required
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          "User-Agent": "LivabilityScoutApp/2.0 (contact@aistudio.internal)",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.statusText}`);
    }
    const data = await response.json();
    setInReverseGeocodeCache(cacheKey, data);
    return res.json(data);
  } catch (error: any) {
    console.error("Reverse geocode error:", error);
    return res.status(500).json({ error: error.message || "Failed to reverse geocode" });
  }
});

// Weather and air-quality data are fetched from Open-Meteo at request time.
// Missing upstream values remain null; no synthetic fallback values are returned.
app.get("/api/weather", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Valid lat/lng are required" });
    }

    const [airResult, weatherResult] = await Promise.allSettled([
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5&timezone=auto`,
        { headers: { "User-Agent": "StreetLens/1.0" } }
      ),
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`,
        { headers: { "User-Agent": "StreetLens/1.0" } }
      ),
    ]);

    const retrievedAt = new Date().toISOString();
    let aqi: number | null = null;
    let pm25: number | null = null;
    let airQualityTimestamp: string | null = null;
    let airQualityStatus: "available" | "empty" | "error" = "error";

    if (airResult.status === "fulfilled" && airResult.value.ok) {
      const data: any = await airResult.value.json();
      aqi = typeof data.current?.us_aqi === "number" ? Math.round(data.current.us_aqi) : null;
      pm25 = typeof data.current?.pm2_5 === "number" ? +data.current.pm2_5.toFixed(1) : null;
      airQualityTimestamp = data.current?.time || null;
      airQualityStatus = aqi !== null || pm25 !== null ? "available" : "empty";
    }

    let temperature: number | null = null;
    let humidity: number | null = null;
    let weatherCode: number | null = null;
    let windSpeed: number | null = null;
    let weatherTimestamp: string | null = null;
    let weatherStatus: "available" | "empty" | "error" = "error";

    if (weatherResult.status === "fulfilled" && weatherResult.value.ok) {
      const data: any = await weatherResult.value.json();
      temperature = typeof data.current?.temperature_2m === "number" ? Math.round(data.current.temperature_2m) : null;
      humidity = typeof data.current?.relative_humidity_2m === "number" ? Math.round(data.current.relative_humidity_2m) : null;
      weatherCode = typeof data.current?.weather_code === "number" ? data.current.weather_code : null;
      windSpeed = typeof data.current?.wind_speed_10m === "number" ? +data.current.wind_speed_10m.toFixed(1) : null;
      weatherTimestamp = data.current?.time || null;
      weatherStatus = temperature !== null || humidity !== null || weatherCode !== null ? "available" : "empty";
    }

    const aqiStatus: '良好' | '普通' | '對敏感族群不健康' | '不健康' | '未知' =
      aqi === null ? '未知' : aqi > 150 ? '不健康' : aqi > 100 ? '對敏感族群不健康' : aqi > 50 ? '普通' : '良好';

    const weatherDescriptions: Record<number, string> = {
      0: '晴朗', 1: '大致晴朗', 2: '多雲', 3: '陰天', 45: '局部有霧', 48: '濃霧',
      51: '毛毛細雨', 53: '輕微短暫雨', 55: '密降毛雨', 61: '小雨', 63: '中雨',
      65: '大雨', 80: '局部短暫陣雨', 81: '強陣雨', 82: '雷陣雨', 95: '雷雨交加',
    };

    return res.json({
      temperature,
      humidity,
      weatherCode,
      condition: weatherCode === null ? null : (weatherDescriptions[weatherCode] || null),
      aqi,
      aqiStatus,
      pm25,
      windSpeed,
      airQualityTimestamp,
      weatherTimestamp,
      retrievedAt,
      source: "Open-Meteo",
      sourceType: "model",
      airQualitySource: "Open-Meteo Air Quality (CAMS model data)",
      status: airQualityStatus === "available" || weatherStatus === "available" ? "available" : "error",
      airQualityStatus,
      weatherStatus,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch weather data" });
  }
});

// Maps Google Places (New) types to our C1–C5 livability categories + note
const GOOGLE_PLACE_TYPE_MAP: Record<string, { category: "C1" | "C2" | "C3" | "C4" | "C5"; note: string }> = {
  police: { category: "C1", note: "社區治安防護據點" },
  police_station: { category: "C1", note: "轄區警察治安機關" },
  fire_station: { category: "C1", note: "消防救災與安全據點" },
  supermarket: { category: "C2", note: "生鮮超市日常採買" },
  grocery_store: { category: "C2", note: "生鮮超市日常採買" },
  asian_grocery_store: { category: "C2", note: "生鮮食材百貨日常採買" },
  discount_supermarket: { category: "C2", note: "民生福利超市生鮮採買" },
  convenience_store: { category: "C2", note: "24H 連鎖超商生活機能" },
  pharmacy: { category: "C2", note: "藥局健保特約醫療處方" },
  drugstore: { category: "C2", note: "藥局健保醫療生活用品" },
  doctor: { category: "C2", note: "基層社區醫療照護" },
  hospital: { category: "C2", note: "區域醫療院所" },
  general_hospital: { category: "C2", note: "綜合醫療中心" },
  medical_center: { category: "C2", note: "專業門診醫療照護據點" },
  clinic: { category: "C2", note: "社區聯合健保診所" },
  dentist: { category: "C2", note: "牙醫診所照護" },
  bakery: { category: "C2", note: "日常烘焙與民生補給" },
  bank: { category: "C2", note: "金融服務與臨櫃ATM" },
  finance: { category: "C2", note: "金融機構與理財服務" },
  post_office: { category: "C2", note: "郵政物流與包裹服務據點" },
  subway_station: { category: "C3", note: "捷運大眾運輸通勤樞紐" },
  train_station: { category: "C3", note: "鐵路大眾運輸通勤樞紐" },
  light_rail_station: { category: "C3", note: "輕軌大眾運輸通勤樞紐" },
  transit_station: { category: "C3", note: "大眾運輸通勤樞紐" },
  bus_station: { category: "C3", note: "公車轉運幹線接駁據點" },
  bus_stop: { category: "C3", note: "市區公車站點便捷候車" },
  park: { category: "C4", note: "鄰里休憩綠地公園" },
  city_park: { category: "C4", note: "都會綠地休憩公園" },
  garden: { category: "C4", note: "林蔭景觀綠帶步道" },
  playground: { category: "C4", note: "兒童遊憩與社區綠地" },
  community_center: { category: "C5", note: "地方社區與公民活動據點" },
  local_government_office: { category: "C5", note: "地方行政與里民服務據點" },
  city_hall: { category: "C5", note: "市政行政便民據點" },
  library: { category: "C5", note: "公共圖書館與文化自修據點" },
  school: { category: "C2", note: "學校教育與日常生活機能" },
  primary_school: { category: "C2", note: "國民小學教育設施" },
  secondary_school: { category: "C2", note: "國民中學教育設施" },
};

// Real POIs from Google Places (New). Scoring queries are separated by
// amenity family so the 20-result API cap for one request cannot hide a category.
type PoiSourceStatus = "available" | "empty" | "timeout" | "error" | "unavailable";

interface PoiFetchResult {
  pois: any[];
  source: "google_places" | "openstreetmap";
  status: PoiSourceStatus;
  retrievedAt: string;
  error?: string;
}

function mapGooglePlace(place: any, retrievedAt: string): any | null {
  if (!place.location?.latitude || !place.location?.longitude) return null;
  const name = place.displayName?.text || "";
  let mapping = place.primaryType ? GOOGLE_PLACE_TYPE_MAP[place.primaryType] : undefined;
  if (!mapping && Array.isArray(place.types)) {
    mapping = place.types.map((t: string) => GOOGLE_PLACE_TYPE_MAP[t]).find(Boolean);
  }

  let category: "C1" | "C2" | "C3" | "C4" | "C5" = mapping?.category || "C2";
  let note = mapping?.note || "日常生活機能據點";

  if (/派出所|分局|警局|警察|消防/.test(name)) { category = "C1"; note = "社區治安防護據點"; }
  else if (/醫院|診所|門診|藥局/.test(name)) { category = "C2"; note = "醫療照護與健保診所"; }
  else if (/超商|全家|7-ELEVEN|全聯|美廉社|家樂福|超市|市場/.test(name)) { category = "C2"; note = "生鮮超市與連鎖超商採買"; }
  else if (/銀行|郵局|ATM|分行|信用合作社/.test(name)) { category = "C2"; note = "金融服務與郵政據點"; }
  else if (/捷運|公車|轉運|火車/.test(name)) { category = "C3"; note = "大眾運輸通勤路網"; }
  else if (/公園|綠地|廣場|庭園/.test(name)) { category = "C4"; note = "鄰里休憩綠地公園"; }
  else if (/圖書館|活動中心|服務中心|分館/.test(name)) { category = "C5"; note = "公共文化與公民活動據點"; }
  else if (/國小|國中|高中|大學/.test(name)) { category = "C2"; note = "學校教育與日常生活機能"; }

  const primary = place.primaryType || "";
  const amenityType =
    /supermarket|grocery_store/.test(primary) ? "supermarket" :
    /convenience_store/.test(primary) ? "convenience" :
    /hospital|pharmacy|doctor|dentist|clinic/.test(primary) ? "clinic" :
    /school|primary_school|secondary_school/.test(primary) ? "school" :
    /bank|post_office|finance/.test(primary) ? "bank_post" :
    /subway_station|train_station|light_rail_station/.test(primary) ? "rail" :
    /transit_station|bus_station|bus_stop/.test(primary) ? "bus" :
    /park|city_park|garden|playground/.test(primary) ? "park" : "other";

  return {
    id: `gp_${place.id}`,
    name,
    category,
    amenityType,
    lat: place.location.latitude,
    lng: place.location.longitude,
    note,
    source: "Google Places (New)",
    sourceType: "api",
    retrievedAt,
  };
}

async function fetchGooglePlacesNearby(lat: number, lng: number): Promise<PoiFetchResult> {
  if (!GOOGLE_MAPS_API_KEY) {
    return { pois: [], source: "google_places", status: "unavailable", retrievedAt: new Date().toISOString() };
  }

  const queryGroups = [
    ["supermarket", "grocery_store"],
    ["convenience_store"],
    ["hospital", "pharmacy", "doctor", "dentist"],
    ["school", "primary_school", "secondary_school"],
    ["bank", "post_office"],
    ["subway_station", "train_station", "light_rail_station"],
    ["bus_station", "bus_stop", "transit_station"],
    ["police", "fire_station"],
    ["park", "city_park", "garden", "playground"],
    ["community_center", "library"],
  ];

  const retrievedAt = new Date().toISOString();
  const settled = await Promise.allSettled(queryGroups.map(async (includedTypes) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.primaryType,places.types",
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: 20,
          rankPreference: "DISTANCE",
          languageCode: "zh-TW",
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 800 } },
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: any = await resp.json();
      return Array.isArray(data.places) ? data.places.map((p: any) => mapGooglePlace(p, retrievedAt)).filter(Boolean) : [];
    } finally {
      clearTimeout(timeoutId);
    }
  }));

  const pois = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failures = settled.filter((result) => result.status === "rejected");
  const hasSuccess = settled.some((result) => result.status === "fulfilled");
  const status: PoiSourceStatus = pois.length ? "available" : !hasSuccess ? "error" : "empty";
  return { pois, source: "google_places", status, retrievedAt };
}

async function fetchOsmPoisNearby(lat: number, lng: number): Promise<PoiFetchResult> {
  const retrievedAt = new Date().toISOString();
  const query = `[out:json][timeout:8];(
    node["amenity"](around:800,${lat},${lng});
    node["shop"](around:800,${lat},${lng});
    node["public_transport"](around:800,${lat},${lng});
    node["railway"](around:800,${lat},${lng});
    node["leisure"="park"](around:800,${lat},${lng});
  );out 100;`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { "User-Agent": "StreetLens/1.0" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: any = await resp.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];
    const pois = elements.map((item: any) => {
      const tags = item.tags || {};
      const pLat = typeof item.lat === "number" ? item.lat : item.center?.lat;
      const pLng = typeof item.lon === "number" ? item.lon : item.center?.lon;
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
      const name = tags["name:zh"] || tags.name || "";
      let category: "C1" | "C2" | "C3" | "C4" | "C5" = "C2";
      if (tags.amenity === "police" || tags.amenity === "fire_station") category = "C1";
      else if (tags.public_transport || tags.railway) category = "C3";
      else if (tags.leisure === "park" || tags.leisure === "garden") category = "C4";
      else if (tags.amenity === "community_centre" || tags.amenity === "townhall" || tags.amenity === "library") category = "C5";

      const amenityType =
        /supermarket|grocery|market/.test(tags.shop || "") ? "supermarket" :
        /convenience/.test(tags.shop || "") ? "convenience" :
        /clinic|doctors|pharmacy|hospital|dentist/.test(tags.amenity || "") ? "clinic" :
        /school|kindergarten|college|university/.test(tags.amenity || "") ? "school" :
        /bank|post_office/.test(tags.amenity || "") ? "bank_post" :
        /bus_stop|bus_station/.test(tags.public_transport || tags.amenity || "") ? "bus" :
        /station|subway|tram/.test(tags.railway || tags.public_transport || "") ? "rail" : "other";

      return {
        id: `osm_${item.type}_${item.id}`,
        name,
        category,
        amenityType,
        lat: pLat,
        lng: pLng,
        source: "OpenStreetMap (Overpass)",
        sourceType: "osm",
        retrievedAt,
      };
    }).filter(Boolean);

    return { pois, source: "openstreetmap", status: pois.length ? "available" : "empty", retrievedAt };
  } catch (error: any) {
    return {
      pois: [],
      source: "openstreetmap",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function haversineDistanceMeters(lat: number, lng: number, pLat: number, pLng: number): number {
  const R = 6371000;
  const dLat = ((pLat - lat) * Math.PI) / 180;
  const dLng = ((pLng - lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat * Math.PI) / 180) * Math.cos((pLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function mergePois(lat: number, lng: number, results: PoiFetchResult[]): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const result of results) {
    for (const poi of result.pois) {
      const key = `${poi.name}|${poi.amenityType}|${poi.lat.toFixed(5)}|${poi.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...poi, distanceMeters: haversineDistanceMeters(lat, lng, poi.lat, poi.lng) });
    }
  }
  return merged.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// Synthetic POIs are intentionally not generated. Nearby POIs must come from
// an external geospatial source so the map never presents invented businesses
// or facilities as real-world locations.

// Static official resources can expose HTTP validators. We use them only in the
// background refresh job; user requests never probe upstream sources.
const VALIDATOR_RESOURCES: Record<string, string[]> = {
  taipei_green: Object.values(GREEN_RESOURCE_URLS),
  taipei_safety: [SAFETY_RESOURCE_URLS.taipeiTrafficAccidentPoints2025],
  taipei_flood: Object.values(FLOOD_RESOURCE_URLS),
};

type ValidatorState = Record<string, { etag?: string; lastModified?: string }>;

function parseValidatorState(snapshot: any): ValidatorState {
  if (!snapshot?.sourceVersion) return {};
  try {
    const parsed = JSON.parse(snapshot.sourceVersion);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const STATIC_VALIDATOR_TIMEOUT_MS = 10_000;

async function checkStaticResourceValidators(
  sourceKey: string,
  snapshot: any,
): Promise<{ decision: "unchanged" | "changed" | "unknown"; version: string | null; method: "etag" | "last_modified" | "unknown"; sourceUpdatedAt: string | null }> {
  const urls = VALIDATOR_RESOURCES[sourceKey];
  if (!urls?.length) return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt: null };

  // On the first refresh there is no prior validator state to compare against.
  // Skip HEAD probes and fetch the real source payload directly.
  if (!snapshot) {
    return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt: null };
  }

  const previous = parseValidatorState(snapshot);
  const state: ValidatorState = {};
  let sawNotModified = 0;
  let sawChanged = 0;
  let sawValidator = false;

  for (const url of urls) {
    const prior = previous[url] || {};
    const headers: Record<string, string> = { "User-Agent": "StreetLens/1.0" };
    if (prior.etag) headers["If-None-Match"] = prior.etag;
    if (prior.lastModified) headers["If-Modified-Since"] = prior.lastModified;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STATIC_VALIDATOR_TIMEOUT_MS);

    try {
      const response = await fetch(url, { method: "HEAD", headers, signal: controller.signal });
      if (response.status === 304) {
        sawNotModified += 1;
        state[url] = prior;
        continue;
      }
      if (!response.ok) return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt: null };

      const etag = response.headers.get("etag") || undefined;
      const lastModified = response.headers.get("last-modified") || undefined;
      if (!etag && !lastModified) return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt: null };
      sawValidator = true;
      state[url] = { etag, lastModified };

      const changed = (prior.etag && etag && prior.etag !== etag)
        || (prior.lastModified && lastModified && prior.lastModified !== lastModified);
      if (changed) sawChanged += 1;
    } catch {
      return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt: null };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const version = JSON.stringify(state);
  const modifiedDates = Object.values(state)
    .map((item) => item.lastModified)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const sourceUpdatedAt = modifiedDates.length
    ? new Date(Math.max(...modifiedDates)).toISOString()
    : null;
  const method = Object.values(state).some((item) => item.etag) ? "etag" : "last_modified";
  if (sawNotModified === urls.length) return { decision: "unchanged", version, method, sourceUpdatedAt };
  if (sawChanged > 0) return { decision: "changed", version, method, sourceUpdatedAt };
  if (sawValidator) return { decision: "unchanged", version, method, sourceUpdatedAt };
  return { decision: "unknown", version: null, method: "unknown", sourceUpdatedAt };
}


const REFRESH_INTERVAL_HOURS: Record<string, number> = {
  google_places: 24,
  openstreetmap: 24,
  tdx_transit: 24,
  taipei_green: 168,
  taipei_safety: 168,
  taipei_flood: 168,
  open_meteo_air_quality: 24,
};

const REFRESH_SOURCE_KEYS = Object.keys(REFRESH_INTERVAL_HOURS);

function refreshPayloadForSource(sourceKey: string, lat: number, lng: number): Promise<any> {
  if (sourceKey === "google_places") return fetchGooglePlacesNearby(lat, lng);
  if (sourceKey === "openstreetmap") return fetchOsmPoisNearby(lat, lng);
  if (sourceKey === "tdx_transit") return fetchTdxTransitData(lat, lng);
  if (sourceKey === "taipei_green") return fetchTaipeiGreenData(lat, lng);
  if (sourceKey === "taipei_safety") return fetchTaipeiSafetyData(lat, lng, 500);
  if (sourceKey === "taipei_flood") return fetchTaipeiFloodHazardData(lat, lng);
  if (sourceKey === "open_meteo_air_quality") {
    return fetch(
      "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lat
      + "&longitude=" + lng + "&current=us_aqi,pm2_5&timezone=auto",
      { headers: { "User-Agent": "StreetLens/1.0" } },
    ).then(async (response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data: any = await response.json();
      return {
        aqi: typeof data.current?.us_aqi === "number" ? Math.round(data.current.us_aqi) : null,
        pm25: typeof data.current?.pm2_5 === "number" ? +data.current.pm2_5.toFixed(1) : null,
        airQualityTimestamp: data.current?.time || null,
        retrievedAt: new Date().toISOString(),
        source: "Open-Meteo Air Quality (CAMS model data)",
        sourceType: "model",
        status: data.current ? "available" : "empty",
      };
    });
  }
  throw new Error("Unknown refresh source: " + sourceKey);
}

// Scheduled refresh is the only place allowed to call scoring data sources.
// Sources with HTTP validators are checked first; unchanged sources are not rewritten.
// Sources without validators are refreshed on their configured cadence.
app.post("/api/internal/refresh-data", async (req: Request, res: Response) => {
  if (!DATA_REFRESH_TOKEN || req.headers.authorization !== "Bearer " + DATA_REFRESH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const requestedSource = typeof req.query.sourceKey === "string" ? req.query.sourceKey : null;
  if (requestedSource && !REFRESH_SOURCE_KEYS.includes(requestedSource)) {
    return res.status(400).json({
      error: "Unknown sourceKey",
      sourceKey: requestedSource,
      allowedSourceKeys: REFRESH_SOURCE_KEYS,
    });
  }

  try {
    await ensureDataCacheSchema();
    const targets = await listActiveAssessmentTargets();
    const results: any[] = [];
    const now = Date.now();
    const sourceKeys = requestedSource ? [requestedSource] : REFRESH_SOURCE_KEYS;

    // Large city-wide sources are fetched once and evaluated against all active
    // targets. This avoids downloading the same multi-MB dataset once per target.
    const batchSourceKeys = new Set(["taipei_green", "taipei_safety", "taipei_flood"]);

    for (const sourceKey of sourceKeys) {
      const targetStates = await Promise.all(targets.map(async (target) => ({
        target,
        existing: await getCachedSnapshot(sourceKey, target.scopeKey),
      })));

      const dueStates = targetStates.filter(({ existing }) =>
        !existing
        || (now - new Date(existing.fetchedAt).getTime()) >= REFRESH_INTERVAL_HOURS[sourceKey] * 60 * 60 * 1000,
      );

      if (!dueStates.length) {
        for (const { target, existing } of targetStates) {
          results.push({
            scopeKey: target.scopeKey,
            sourceKey,
            changed: false,
            status: existing?.status || "unavailable",
            skipped: true,
            reason: "cadence",
            fetchedAt: existing?.fetchedAt || null,
            checkedAt: existing?.checkedAt || null,
          });
        }
        continue;
      }

      let validator: Awaited<ReturnType<typeof checkStaticResourceValidators>> = {
        decision: "unknown",
        version: null,
        method: "unknown",
        sourceUpdatedAt: null,
      };
      const validatorSample = dueStates.find(({ existing }) => existing?.sourceVersion)?.existing || null;
      if (validatorSample && VALIDATOR_RESOURCES[sourceKey]?.length) {
        validator = await checkStaticResourceValidators(sourceKey, validatorSample);
      }

      if (
        validatorSample
        && validator.decision === "unchanged"
        && dueStates.every(({ existing }) => Boolean(existing))
      ) {
        for (const { target, existing } of dueStates) {
          await markSnapshotChecked(sourceKey, target.scopeKey, {
            sourceVersion: validator.version,
            sourceUpdatedAt: validator.sourceUpdatedAt,
            freshnessMethod: validator.method,
          });
          results.push({
            scopeKey: target.scopeKey,
            sourceKey,
            changed: false,
            status: existing!.status,
            skipped: true,
            reason: "source-unchanged",
            fetchedAt: existing!.fetchedAt,
            sourceVersion: validator.version,
          });
        }
        continue;
      }

      if (batchSourceKeys.has(sourceKey)) {
        const batchTargets = dueStates.map(({ target }) => ({
          scopeKey: target.scopeKey,
          latitude: target.latitude,
          longitude: target.longitude,
        }));

        let payloads: Record<string, any>;
        if (sourceKey === "taipei_green") {
          payloads = await fetchTaipeiGreenDataForTargets(batchTargets, 800);
        } else if (sourceKey === "taipei_safety") {
          payloads = await fetchTaipeiSafetyDataForTargets(batchTargets, 500);
        } else {
          payloads = await fetchTaipeiFloodHazardDataForTargets(batchTargets);
        }

        for (const { target, existing } of dueStates) {
          const payload = payloads[target.scopeKey];
          if (!payload || payload.status === "error" || payload.status === "timeout") {
            results.push({
              scopeKey: target.scopeKey,
              sourceKey,
              changed: false,
              status: existing?.status || "unavailable",
              skipped: false,
              error: payload?.error || "Batch source refresh failed",
              preservedExisting: Boolean(existing),
            });
            continue;
          }

          const saved = await saveSnapshot(sourceKey, target.scopeKey, payload, {
            status: String(payload.status || "available"),
            sourceVersion: validator.version,
            sourceUpdatedAt: validator.sourceUpdatedAt,
            freshnessMethod: validator.method,
          });

          results.push({
            scopeKey: target.scopeKey,
            sourceKey,
            changed: saved.changed,
            status: payload.status || "available",
            skipped: false,
            freshnessMethod: validator.method,
            sourceVersion: validator.version,
          });
        }
        continue;
      }

      // Target-specific sources are fetched independently.
      for (const { target, existing } of dueStates) {
        const payload = await refreshPayloadForSource(sourceKey, target.latitude, target.longitude).catch(
          (error: any) => ({ __error: error?.message || String(error) }),
        );

        if (payload?.__error) {
          results.push({
            scopeKey: target.scopeKey,
            sourceKey,
            changed: false,
            status: existing?.status || "unavailable",
            skipped: false,
            error: payload.__error,
            preservedExisting: Boolean(existing),
          });
          continue;
        }

        const saved = await saveSnapshot(sourceKey, target.scopeKey, payload, {
          status: String(payload?.status || "available"),
          sourceVersion: validator.version,
          sourceUpdatedAt: validator.sourceUpdatedAt,
          freshnessMethod: validator.method,
        });

        results.push({
          scopeKey: target.scopeKey,
          sourceKey,
          changed: saved.changed,
          status: payload?.status || "available",
          skipped: false,
          freshnessMethod: validator.method,
          sourceVersion: validator.version,
        });
      }
    }

    return res.json({
      refreshedAt: new Date().toISOString(),
      targetCount: targets.length,
      sourceKeys,
      snapshots: results,
    });
  } catch (error: any) {
    console.error("Scheduled data refresh failed:", error);
    return res.status(500).json({ error: error.message || "Failed to refresh persisted data" });
  }
});

// 即時附近 POI 端點 — Google Places API (New) 優先，OSM Overpass 其次，
// 結合在地空間開放常模確保各點位皆有清晰對應的生活機能標記
app.get("/api/nearby-pois", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Valid lat/lng are required" });
    const scopeKey = await registerAssessmentTarget(lat, lng);
    if (!scopeKey) return res.status(503).json({ error: "Persistent data cache is not configured" });
    const [google, osm] = await Promise.all([getCachedSnapshot("google_places", scopeKey), getCachedSnapshot("openstreetmap", scopeKey)]);
    if (!google && !osm) return res.status(202).json({ pois: [], dataStatus: "pending_refresh", scopeKey });
    const pois = mergePois(lat, lng, [google?.payload, osm?.payload].filter(Boolean));
    return res.json({ pois, dataStatus: "cached", scopeKey, sources: [
      google ? { source: google.sourceKey, status: google.status, retrievedAt: google.fetchedAt } : { source: "google_places", status: "unavailable" },
      osm ? { source: osm.sourceKey, status: osm.status, retrievedAt: osm.fetchedAt } : { source: "openstreetmap", status: "unavailable" },
    ] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to load cached POIs" });
  }
});

// Polyline decode helper for Google Routes API
function decodeGooglePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// 實時真實道路路網幾何端點 (以 Google Routes API + OSRM 取得精準貼路幾何 Polylines)
app.get("/api/street-network", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat((req.query.lat as string) || "25.0326");
    const lng = parseFloat((req.query.lng as string) || "121.5298");
        const streetName = (req.query.streetName as string) || "";

    const delta = 0.0035; // ~350m
    const corridorPairs = [
      { origin: { lat: lat - delta, lng }, dest: { lat: lat + delta, lng } },
      { origin: { lat, lng: lng - delta }, dest: { lat, lng: lng + delta } },
      { origin: { lat: lat - delta * 0.7, lng: lng - delta * 0.7 }, dest: { lat: lat + delta * 0.7, lng: lng + delta * 0.7 } },
      { origin: { lat: lat - delta * 0.7, lng: lng + delta * 0.7 }, dest: { lat: lat + delta * 0.7, lng: lng - delta * 0.7 } },
    ];

    const segments: any[] = [];
    const seenRoads = new Set<string>();

    if (GOOGLE_MAPS_API_KEY) {
      for (const pair of corridorPairs) {
        if (segments.length >= 8) break;
        try {
          const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
              "X-Goog-FieldMask": "routes.legs.steps.navigationInstruction,routes.legs.steps.polyline",
            },
            body: JSON.stringify({
              origin: { location: { latLng: { latitude: pair.origin.lat, longitude: pair.origin.lng } } },
              destination: { location: { latLng: { latitude: pair.dest.lat, longitude: pair.dest.lng } } },
              travelMode: "DRIVE",
              polylineQuality: "HIGH_QUALITY",
            }),
          });

          if (resp.ok) {
            const data: any = await resp.json();
            const steps = data.routes?.[0]?.legs?.[0]?.steps || [];
            for (const s of steps) {
              if (segments.length >= 8) break;
              if (!s.polyline?.encodedPolyline) continue;
              const pts = decodeGooglePolyline(s.polyline.encodedPolyline);
              if (pts.length < 2) continue;

              const instruction = s.navigationInstruction?.instructions || "";
              const match = instruction.match(/(?:走|沿|向.+?轉入|進入|繼續行駛)([\u4e00-\u9fa5\w\s]+?)(?:朝|前進|目的地|向|\d+巷|\d+弄|,|$)/);
              const rawName = match && match[1] ? match[1].trim() : instruction.slice(0, 15);
              let roadName = rawName
                .replace(/(^接著走|^向[左右]轉[，,]?朝?|^朝|^進入|^沿)/g, "")
                .replace(/(目的地在.+|朝.+前進)/g, "")
                .trim();

              if (!roadName || roadName.length < 2) continue;
              if (seenRoads.has(roadName)) continue;
              seenRoads.add(roadName);

              segments.push({
                id: `seg_g_${segments.length}_${roadName}`,
                name: roadName,
                coords: pts,
                clsScore: null,
                c1: null,
                c2: null,
                c3: null,
                c4: null,
                c5: null,
              });
            }
          }
        } catch (e) {
          // ignore corridor error
        }
      }
    }

    // 2. OSRM fallback/enrichment for local lanes if needed
    if (segments.length < 4) {
      try {
        const nearestUrl = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=6`;
        const nr = await fetch(nearestUrl);
        const nd: any = await nr.json();
        for (const wp of nd.waypoints || []) {
          if (segments.length >= 8) break;
          const name = wp.name;
          if (!name || seenRoads.has(name)) continue;
          seenRoads.add(name);

          const [wLng, wLat] = wp.location;
          const p1 = `${(wLng - 0.0015).toFixed(6)},${(wLat - 0.0015).toFixed(6)}`;
          const p2 = `${(wLng + 0.0015).toFixed(6)},${(wLat + 0.0015).toFixed(6)}`;
          const rUrl = `https://router.project-osrm.org/route/v1/driving/${p1};${p2}?overview=full&geometries=geojson&steps=true`;
          const rRes = await fetch(rUrl);
          const rData: any = await rRes.json();
          const steps = rData.routes?.[0]?.legs?.[0]?.steps || [];
          for (const s of steps) {
            if (s.geometry?.coordinates?.length > 1 && s.name && !seenRoads.has(s.name + "_osrm")) {
              seenRoads.add(s.name + "_osrm");
              const coords = s.geometry.coordinates.map(([cLng, cLat]: [number, number]) => [cLat, cLng]);
              segments.push({
                id: `seg_osrm_${segments.length}_${s.name}`,
                name: s.name,
                coords,
                clsScore: null,
                c1: null,
                c2: null,
                c3: null,
                c4: null,
                c5: null,
              });
              break;
            }
          }
        }
      } catch (e) {
        // ignore OSRM error
      }
    }

    return res.json({ segments });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch street network" });
  }
});

// Taiwan official/public transport source adapters.
// Distances are calculated from source coordinates; no frequency or accessibility
// score is invented when the source does not provide it.
interface TransitSourceResult {
  stops: any[];
  source: string;
  status: "available" | "empty" | "error" | "timeout";
  retrievedAt: string;
  error?: string;
}

async function fetchTaiwanTransitData(lat: number, lng: number): Promise<TransitSourceResult> {
  const retrievedAt = new Date().toISOString();
  // Taipei City bus-stop open data is published by Taipei City Transportation Department.
  // Keep the endpoint configurable because data.gov.tw resource URLs can change.
  const url = process.env.TAIPEI_BUS_STOPS_URL;
  if (!url) {
    return { stops: [], source: "Taipei City Transportation Department bus-stop data", status: "empty", retrievedAt };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "StreetLens/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: any = await response.json();
    const rows = Array.isArray(data) ? data : Array.isArray(data.result) ? data.result : [];
    const stops = rows.map((row: any) => ({
      id: String(row.id ?? row.stopLocationId ?? row.BSM_BUSSTO ?? ""),
      name: row.nameZh ?? row.BSM_CHINES ?? row.name ?? "",
      lat: Number(row.latitude ?? row.lat ?? row.showLat),
      lng: Number(row.longitude ?? row.lon ?? row.showLon),
      type: "bus",
      source: "Taipei City Transportation Department",
      retrievedAt,
    })).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    const nearby = stops
      .map((stop: any) => ({ ...stop, distanceMeters: haversineDistanceMeters(lat, lng, stop.lat, stop.lng) }))
      .filter((stop: any) => stop.distanceMeters <= 1500)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);

    return { stops: nearby, source: "Taipei City Transportation Department", status: nearby.length ? "available" : "empty", retrievedAt };
  } catch (error: any) {
    return {
      stops: [],
      source: "Taipei City Transportation Department",
      status: error?.name === "AbortError" ? "timeout" : "error",
      retrievedAt,
      error: error?.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// 台灣各主要行政區在 8 大資料來源下的基準常模庫
// No synthetic regional measurements are exposed. Source-backed indicators are added
// category by category; unavailable indicators remain null.
app.get("/api/baseline-data", async (_req: Request, res: Response) => {
  return res.json({
    source: "unavailable",
    available: false,
    c1: null,
    c2: null,
    c3: null,
    c4: null,
    c5: null,
  });
});


// Explainable street-level assessment assembled from source-backed inputs.
// This endpoint intentionally returns provenance and confidence with every score.
export function getAssessmentSnapshotStatus(
  sourceKeys: string[],
  snapshots: Record<string, { status?: string } | null | undefined>,
): { missingSources: string[]; dataStatus: "pending_refresh" | "cached" } {
  const missingSources = sourceKeys.filter((key) => !snapshots[key]);
  return {
    missingSources,
    dataStatus: missingSources.length === sourceKeys.length ? "pending_refresh" : "cached",
  };
}

app.get("/api/assessment", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const district = (req.query.district as string) || "";
    const city = (req.query.city as string) || "";
    const streetName = (req.query.streetName as string) || "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Valid lat/lng are required" });

    const scopeKey = await registerAssessmentTarget(lat, lng);
    if (!scopeKey) return res.status(503).json({ error: "Persistent data cache is not configured", dataStatus: "database_required" });

    const sourceKeys = ["google_places", "openstreetmap", "tdx_transit", "taipei_green", "taipei_safety", "taipei_flood", "open_meteo_air_quality"];
    const nearbyCacheSources = new Set([
      "google_places",
      "openstreetmap",
      "tdx_transit",
      "taipei_green",
      "taipei_safety",
    ]);
    const exactCached = await Promise.all(sourceKeys.map((key) => getCachedSnapshot(key, scopeKey)));
    const snapshots: Record<string, any> = {};
    const snapshotOrigins: Record<string, { scopeKey: string; scopeDistanceMeters: number; reused: boolean }> = {};

    await Promise.all(sourceKeys.map(async (key, index) => {
      const exact = exactCached[index];
      if (exact) {
        snapshots[key] = exact;
        snapshotOrigins[key] = { scopeKey: exact.scopeKey, scopeDistanceMeters: 0, reused: false };
        return;
      }
      if (!nearbyCacheSources.has(key)) {
        snapshots[key] = null;
        return;
      }
      const nearby = await getNearestCachedSnapshot(key, lat, lng, 250);
      snapshots[key] = nearby;
      if (nearby) {
        snapshotOrigins[key] = {
          scopeKey: nearby.scopeKey,
          scopeDistanceMeters: Number(nearby.scopeDistanceMeters),
          reused: true,
        };
      }
    }));

    const { missingSources: missing, dataStatus } = getAssessmentSnapshotStatus(sourceKeys, snapshots);
    if (dataStatus === "pending_refresh") {
      return res.status(202).json({
        location: { lat, lng, city, district, streetName },
        scopeKey,
        dataStatus: "pending_refresh",
        missingSources: missing,
        scores: null,
        message: "此座標尚無任何已持久化資料；等待背景排程建立資料快照。",
      });
    }

    // A user request never fetches external scoring sources. Existing snapshots are
    // returned even when stale; only genuinely absent source data is marked unavailable.
    const google = snapshots.google_places?.payload || { pois: [] };
    const osm = snapshots.openstreetmap?.payload || { pois: [] };
    const officialTransit = snapshots.tdx_transit?.payload || { stops: [], railStations: [] };
    const distanceMetersFromTarget = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
      const R = 6371000;
      const dLat = (bLat - aLat) * Math.PI / 180;
      const dLng = (bLng - aLng) * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };
    const greenPayload = snapshots.taipei_green?.payload || { streetTrees: [], parkTrees: [], status: "unavailable" };
    const greenData = {
      ...greenPayload,
      streetTrees: Array.isArray(greenPayload.streetTrees)
        ? greenPayload.streetTrees.filter((x: any) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
            && distanceMetersFromTarget(lat, lng, Number(x.lat), Number(x.lng)) <= 800)
        : [],
      parkTrees: Array.isArray(greenPayload.parkTrees)
        ? greenPayload.parkTrees.filter((x: any) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
            && distanceMetersFromTarget(lat, lng, Number(x.lat), Number(x.lng)) <= 800)
        : [],
    };
    const safetyPayload = snapshots.taipei_safety?.payload || { accidents: [], status: "unavailable", source: "unavailable" };
    const safetyData = {
      ...safetyPayload,
      accidents: Array.isArray(safetyPayload.accidents)
        ? safetyPayload.accidents.filter((x: any) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
            && distanceMetersFromTarget(lat, lng, Number(x.lat), Number(x.lng)) <= 500)
        : [],
    };
    const floodData = snapshots.taipei_flood?.payload || { cells: [], status: "unavailable" };
    const weather = {
      ...(snapshots.open_meteo_air_quality?.payload || { aqi: null, pm25: null, status: "unavailable" }),
      retrievedAt: snapshots.open_meteo_air_quality?.fetchedAt || undefined,
    };
    const pois = mergePois(lat, lng, [google, osm]);
    const nearest = (type: string): number | undefined => {
      const values = pois.filter((poi: any) => poi.amenityType === type && Number.isFinite(poi.distanceMeters)).map((poi: any) => poi.distanceMeters);
      return values.length ? Math.min(...values) : undefined;
    };
    const sourceNames = [...new Set(pois.map((poi: any) => poi.source).filter(Boolean))];
    const c2PoiMetrics = {
      supermarketDist: nearest("supermarket"), convenienceDist: nearest("convenience"), clinicDist: nearest("clinic"), schoolDist: nearest("school"), bankPostDist: nearest("bank_post"),
      poiDensityCount: pois.filter((poi: any) => poi.category === "C2").length || undefined,
      source: sourceNames.length ? sourceNames.join(" + ") : "unavailable", method: "calculated" as const,
      confidence: sourceNames.length > 1 ? "high" as const : sourceNames.length === 1 ? "medium" as const : "low" as const,
      status: sourceNames.length ? "available" as const : "empty" as const,
      retrievedAt: snapshots.google_places?.fetchedAt || snapshots.openstreetmap?.fetchedAt,
    };

    const railDistances = (officialTransit.railStations || [])
      .map((x: any) => {
        const pLat = Number(x.lat), pLng = Number(x.lng);
        return Number.isFinite(pLat) && Number.isFinite(pLng) ? distanceMetersFromTarget(lat, lng, pLat, pLng) : null;
      })
      .filter((x: any) => Number.isFinite(x) && x <= 1500);
    const busDistances = (officialTransit.stops || [])
      .map((x: any) => {
        const pLat = Number(x.lat), pLng = Number(x.lng);
        return Number.isFinite(pLat) && Number.isFinite(pLng) ? distanceMetersFromTarget(lat, lng, pLat, pLng) : null;
      })
      .filter((x: any) => Number.isFinite(x) && x <= 1500);
    const osmRail = pois.filter((x: any) => x.amenityType === "rail").map((x: any) => x.distanceMeters).filter((x: any) => Number.isFinite(x));
    const osmBus = pois.filter((x: any) => x.amenityType === "bus").map((x: any) => x.distanceMeters).filter((x: any) => Number.isFinite(x));
    const railDist = railDistances.length ? Math.min(...railDistances) : (osmRail.length ? Math.min(...osmRail) : undefined);
    const busDist = busDistances.length ? Math.min(...busDistances) : (osmBus.length ? Math.min(...osmBus) : undefined);
    const transitSources = [
      ...(railDistances.length || busDistances.length ? ["TDX / MOTC"] : []),
      ...(osmRail.length || osmBus.length ? [...new Set(pois.filter((x: any) => x.amenityType === "rail" || x.amenityType === "bus").map((x: any) => x.source).filter(Boolean))] : []),
    ];
    const c3RetrievedAt = transitSources.includes("TDX / MOTC")
      ? snapshots.tdx_transit?.fetchedAt
      : [...new Set(pois.filter((x: any) => x.amenityType === "rail" || x.amenityType === "bus").map((x: any) => x.retrievedAt).filter(Boolean))].join(" + ") || undefined;
    const c3TransitMetrics = {
      mrtOrRailDist: railDist, busStopDist: busDist,
      source: transitSources.length ? transitSources.join(" + ") : "unavailable", method: "calculated" as const,
      confidence: railDistances.length && busDistances.length ? "high" as const : railDist != null || busDist != null ? "medium" as const : "low" as const,
      status: railDist != null || busDist != null ? "available" as const : "empty" as const,
      retrievedAt: c3RetrievedAt,
    };

    const parkPois = pois.filter((x: any) => x.amenityType === "park" && Number.isFinite(x.distanceMeters) && x.distanceMeters <= 800);
    const nearestParkDist = parkPois.length ? Math.min(...parkPois.map((x: any) => x.distanceMeters)) : undefined;
    const communityPois = pois.filter((x: any) =>
      (x.category === "C5" || /community|library|活動中心|圖書館|服務中心|公民/.test(String(x.name || "")))
      && Number.isFinite(x.distanceMeters)
    );
    const nearestCommunityCulturalDistance = communityPois.length
      ? Math.min(...communityPois.map((x: any) => x.distanceMeters))
      : undefined;
    const GREEN_RADIUS_METERS = 800;
    const GREEN_OBSERVATION_AREA_KM2 = Math.PI * (GREEN_RADIUS_METERS / 1000) ** 2;
    const streetTreeCount800m = greenData.streetTrees?.length;
    const parkTreeCount800m = greenData.parkTrees?.length;
    const c4GreenMetrics: C4GreenMetrics = {
      streetTreeCount800m: Number.isFinite(Number(streetTreeCount800m)) ? Number(streetTreeCount800m) : undefined,
      parkTreeCount800m: Number.isFinite(Number(parkTreeCount800m)) ? Number(parkTreeCount800m) : undefined,
      streetTreeDensityPerKm2: Number.isFinite(Number(streetTreeCount800m))
        ? Number(streetTreeCount800m) / GREEN_OBSERVATION_AREA_KM2
        : undefined,
      parkTreeDensityPerKm2: Number.isFinite(Number(parkTreeCount800m))
        ? Number(parkTreeCount800m) / GREEN_OBSERVATION_AREA_KM2
        : undefined,
      nearestParkDist,
      parkCount800m: parkPois.length || undefined,
      source: greenData.source || "Taipei City Parks and Street Trees dataset",
      method: "calculated" as const,
      confidence: greenData.status === "available" ? "high" as const : "low" as const,
      status: greenData.status,
      retrievedAt: greenData.retrievedAt,
      streetTreeDensityReference: [],
      parkTreeDensityReference: [],
    };

    const accidents = safetyData.accidents || [];
    const c1SafetyMetrics: C1SafetyMetrics = {
      accidentCount500m: accidents.length,
      fatalAccidentCount500m: accidents.filter((x: any) => /1類|A1|死亡/.test(String(x.type || ""))).length,
      injuryAccidentCount500m: accidents.filter((x: any) => /2類|A2|受傷/.test(String(x.type || ""))).length,
      source: safetyData.source, method: "official" as const, confidence: safetyData.status === "available" || safetyData.status === "empty" ? "high" as const : "low" as const,
      status: safetyData.status, retrievedAt: safetyData.retrievedAt, floodHazard: floodData.cells || [], floodSource: floodData.source || null,
      accidentCountReference: [], floodDepthReference: [],
    };

    const greenReference = await getGreenDensityReference();
    c4GreenMetrics.streetTreeDensityReference = greenReference.street;
    c4GreenMetrics.parkTreeDensityReference = greenReference.park;

    const [safetyReference, amenityReference, communityReference, normalizationReferences, nearestParkReference, nearestCommunityReference] = await Promise.all([
      getSafetyReference(),
      getPoiDensityReference(),
      getC5CommunityReference(),
      getDistanceAndAirQualityReferences(),
      getNearestParkDistanceReference(scopeKey),
      getNearestCommunityDistanceReference(scopeKey),
    ]);
    c1SafetyMetrics.accidentCountReference = safetyReference.accidentCounts;
    c1SafetyMetrics.floodDepthReference = safetyReference.floodDepths;
    const communityCount = pois.filter((poi: any) =>
      poi.category === "C5"
      || /community|library|活動中心|圖書館|服務中心|公民/.test(String(poi.name || "")),
    ).length;
    const scores = calculateAssessment(
      null,
      {},
      weather || undefined,
      c1SafetyMetrics,
      c2PoiMetrics,
      c3TransitMetrics,
      c4GreenMetrics,
      amenityReference,
      communityCount,
      communityReference,
      nearestCommunityCulturalDistance,
      {
        ...normalizationReferences,
        c4NearestParkDistances: nearestParkReference,
        c5NearestCommunityDistances: nearestCommunityReference,
      },
      {
        c4NearestParkSource: parkPois.length ? [...new Set(parkPois.map((x: any) => x.source).filter(Boolean))].join(" + ") : undefined,
        c4NearestParkRetrievedAt: parkPois.length ? (snapshots.google_places?.fetchedAt || snapshots.openstreetmap?.fetchedAt) : undefined,
        c4ParkSource: parkPois.length ? [...new Set(parkPois.map((x: any) => x.source).filter(Boolean))].join(" + ") : undefined,
        c4ParkRetrievedAt: parkPois.length ? (snapshots.google_places?.fetchedAt || snapshots.openstreetmap?.fetchedAt) : undefined,
        c5Source: communityPois.length ? [...new Set(communityPois.map((x: any) => x.source).filter(Boolean))].join(" + ") : undefined,
        c5RetrievedAt: communityPois.length ? (snapshots.google_places?.fetchedAt || snapshots.openstreetmap?.fetchedAt) : undefined,
      },
    );
    const factors = [...scores.c1.factors, ...scores.c2.factors, ...scores.c3.factors, ...scores.c4.factors, ...scores.c5.factors];
    return res.json({
      location: { lat, lng, city, district, streetName }, scopeKey, dataStatus: "cached", scores, factors, poiCount: pois.length,
      dataSources: sourceNames,
      sourceStatus: sourceKeys.map((key) => ({
        source: key,
        status: snapshots[key]?.status || "unavailable",
        retrievedAt: snapshots[key]?.fetchedAt || null,
        checkedAt: snapshots[key]?.checkedAt || null,
        sourceVersion: snapshots[key]?.sourceVersion || null,
        freshnessMethod: snapshots[key]?.freshnessMethod || "unknown",
        cacheScopeDistanceMeters: snapshotOrigins[key]?.scopeDistanceMeters ?? 0,
        reusedNearbySnapshot: snapshotOrigins[key]?.reused ?? false,
      })),
      missingSources: missing, weatherStatus: weather?.status || "unavailable", generatedAt: new Date().toISOString(),
      dataRetrievedAt: Object.fromEntries(sourceKeys.map((key) => [key, snapshots[key]?.fetchedAt || null])),
      c2DataMode: "persisted-cache", c2PoiMetrics, c2PoiCount: pois.filter((x: any) => x.category === "C2").length,
      c3TransitMetrics, c4GreenMetrics, c1SafetyMetrics, c1TrafficAccidents: accidents, floodHazard: floodData.cells || [],
      parkMetrics: { nearestParkDist: nearestParkDist ?? null, parkCount800m: parkPois.length },
      communityMetrics: {
        nearestCommunityCulturalDistance: nearestCommunityCulturalDistance ?? null,
        communityCulturalPoiCount800m: communityPois.length,
      },
    });
  } catch (error: any) {
    console.error("Assessment error:", error);
    return res.status(500).json({ error: error.message || "Failed to calculate assessment" });
  }
});

// 實勘結果綜合分析與診斷報告
app.post("/api/assessment/field-adjustment", async (req: Request, res: Response) => {
  try {
    const baselineCls = req.body?.baselineCls;
    const ratings = req.body?.ratings;
    if (baselineCls !== null && (!Number.isFinite(Number(baselineCls)) || Number(baselineCls) < 0 || Number(baselineCls) > 100)) {
      return res.status(400).json({ error: "baselineCls must be null or a number from 0 to 100" });
    }
    if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) {
      return res.status(400).json({ error: "ratings must be an object" });
    }

    const result = applyFieldObservationAdjustment(
      baselineCls === null ? null : Number(baselineCls),
      ratings as Record<string, number>,
    );

    return res.json({
      baselineCls: result.baselineCls,
      adjustedCls: result.adjustedCls,
      adjustment: result.adjustment,
      categoryAdjustments: result.categoryAdjustments,
      itemAdjustments: result.itemAdjustments,
      ratedItemCount: result.ratedItemCount,
      model: {
        ratingScale: {
          values: [1, 2, 3, 4],
          labels: ["Poor", "Fair", "Good", "Great"],
        },
        categoryCap: 10,
        weighting: { C1: 0.2, C2: 0.2, C3: 0.2, C4: 0.2, C5: 0.2 },
        evidenceRequirement: "note_recommended",
        note: "Field observations adjust the source-backed baseline; they do not replace external data.",
      },
    });
  } catch (error) {
    console.error("Field observation adjustment error:", error);
    return res.status(500).json({ error: "Unable to calculate field observation adjustment" });
  }
});

function normalizeGeminiList(value: unknown, maxItems = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeGeminiExplanation(value: any) {
  const summary = typeof value?.summary === "string" ? value.summary.trim().slice(0, 500) : "";
  if (!summary) {
    throw new Error("Gemini returned an explanation without a summary");
  }
  return {
    summary,
    strengths: normalizeGeminiList(value?.strengths),
    limitations: normalizeGeminiList(value?.limitations),
    fieldObservations: normalizeGeminiList(value?.fieldObservations),
    followUpChecks: normalizeGeminiList(value?.followUpChecks),
  };
}

app.post("/api/assessments/:id/explanation", async (req: Request, res: Response) => {
  try {
    await waitForPersistenceSchema();

    const workspaceId = req.query.workspaceId;
    const record = await getAssessmentSession(workspaceId, req.params.id);
    if (!record) {
      return res.status(404).json({ error: "Saved assessment not found" });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: "Gemini explanation service is not configured" });
    }

    const snapshot = record.assessmentSnapshot && typeof record.assessmentSnapshot === "object"
      ? record.assessmentSnapshot
      : {};
    const factors = Array.isArray((snapshot as any).factors)
      ? (snapshot as any).factors.slice(0, 100)
      : [];
    const sourceStatus = Array.isArray((snapshot as any).sourceStatus)
      ? (snapshot as any).sourceStatus.slice(0, 30)
      : [];

    const explanationInput = {
      location: {
        streetName: record.streetName,
        district: record.district,
        city: record.city,
        latitude: record.coords.lat,
        longitude: record.coords.lng,
      },
      persistedAssessment: {
        categoryScores: record.scores,
        baselineCls: record.baselineClsScore,
        adjustedCls: record.clsScore,
        fieldAdjustment: record.fieldAdjustment,
        sourceDataStatus: (snapshot as any).dataStatus ?? "unknown",
        factors,
        sourceStatus,
      },
      fieldObservation: {
        ratings: record.observationRatings || {},
        categoryAdjustments: record.fieldAdjustmentDetails?.categoryAdjustments || {
          C1: 0, C2: 0, C3: 0, C4: 0, C5: 0,
        },
        ratedItemCount: record.fieldAdjustmentDetails?.ratedItemCount || 0,
        note: record.fieldNotes || "",
        evidenceNotes: (record.evidence || [])
          .filter((item) => item.note)
          .map((item) => ({
            type: item.type,
            capturedAt: item.capturedAt,
            note: item.note,
          })),
      },
    };

    const prompt = `You are the explanation layer for StreetLens, a street-level livability assessment product.

Use ONLY the persisted assessment data provided below.

Hard rules:
1. Do not calculate, recalculate, normalize, or invent any score.
2. Do not fill missing, null, unavailable, or insufficient data with assumptions or outside knowledge.
3. Any numeric claim must come directly from the provided data.
4. Clearly distinguish source-backed assessment facts from user field observations.
5. A field observation may explain an adjustment, but it must never be presented as source data.
6. Do not rank streets, declare a winner, or recommend one street over another.
7. Follow-up checks must be framed as things a person could verify in the field, not as claimed facts.
8. Keep the answer concise and evidence-oriented.

Persisted data:
${JSON.stringify(explanationInput)}

Return JSON only with this exact shape:
{
  "summary": "A concise explanation of what the saved session shows and what remains uncertain.",
  "strengths": ["up to 3 source-backed or explicitly observed strengths"],
  "limitations": ["up to 3 important data limitations or uncertainties"],
  "fieldObservations": ["up to 3 relevant observations from the saved field session"],
  "followUpChecks": ["up to 3 concrete things to verify on a future visit"]
}`;

    const textResponse = await generateGeminiContentWithFallback(
      ai,
      prompt,
      "application/json",
    );
    const cleaned = String(textResponse || "")
      .replace(/^\s*\`\`\`json\s*/i, "")
      .replace(/\s*\`\`\`\s*$/i, "")
      .trim();
    const parsed = normalizeGeminiExplanation(JSON.parse(cleaned));

    return res.json({
      source: "gemini_ai",
      generatedAt: new Date().toISOString(),
      ...parsed,
    });
  } catch (error: any) {
    console.error("Persisted assessment explanation error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate assessment explanation" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
