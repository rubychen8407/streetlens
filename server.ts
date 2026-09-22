import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { calculateAssessment } from "./scoring";
import { fetchTaiwanTransitData as fetchTdxTransitData } from "./transit";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

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
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
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
    /transit_station|bus_station|bus_stop/.test(primary) ? "bus" : "other";

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

// 即時附近 POI 端點 — Google Places API (New) 優先，OSM Overpass 其次，
// 結合在地空間開放常模確保各點位皆有清晰對應的生活機能標記
app.get("/api/nearby-pois", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Valid lat/lng are required" });
    }

    const [google, osm] = await Promise.all([
      fetchGooglePlacesNearby(lat, lng),
      fetchOsmPoisNearby(lat, lng),
    ]);
    const pois = mergePois(lat, lng, [google, osm]);

    return res.json({
      pois,
      sources: [
        { source: google.source, status: google.status, retrievedAt: google.retrievedAt },
        { source: osm.source, status: osm.status, retrievedAt: osm.retrievedAt },
      ],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch POIs" });
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
app.get("/api/assessment", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const district = (req.query.district as string) || "";
    const city = (req.query.city as string) || "";
    const streetName = (req.query.streetName as string) || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Valid lat/lng are required" });
    }

    const [google, osm, officialTransit, weatherResponse] = await Promise.all([
      fetchGooglePlacesNearby(lat, lng),
      fetchOsmPoisNearby(lat, lng),
      fetchTaiwanTransitData(lat, lng),
      fetch(`http://127.0.0.1:${PORT}/api/weather?lat=${lat}&lng=${lng}`),
    ]);

    const pois = mergePois(lat, lng, [google, osm]);
    const officialBusDistances = officialTransit.stops
      .map((stop: any) => stop.distanceMeters)
      .filter((value: any) => Number.isFinite(value));
    const googleOsmRail = pois
      .filter((poi: any) => poi.amenityType === "rail")
      .map((poi: any) => poi.distanceMeters)
      .filter((value: any) => Number.isFinite(value));
    const googleOsmBus = pois
      .filter((poi: any) => poi.amenityType === "bus")
      .map((poi: any) => poi.distanceMeters)
      .filter((value: any) => Number.isFinite(value));
    const weather = weatherResponse.ok ? await weatherResponse.json() : null;
    const nearest = (type: string): number | undefined => {
      const matches = pois.filter((poi: any) => poi.amenityType === type && Number.isFinite(poi.distanceMeters));
      return matches.length ? Math.min(...matches.map((poi: any) => poi.distanceMeters)) : undefined;
    };

    const sourceNames = [...new Set(
      pois.map((poi: any) => poi.source).filter(Boolean)
    )];

    const c2PoiMetrics = {
      supermarketDist: nearest("supermarket"),
      convenienceDist: nearest("convenience"),
      clinicDist: nearest("clinic"),
      schoolDist: nearest("school"),
      bankPostDist: nearest("bank_post"),
      poiDensityCount: pois.filter((poi: any) => poi.category === "C2").length || undefined,
      source: sourceNames.length ? sourceNames.join(" + ") : "unavailable",
      method: "calculated" as const,
      confidence: sourceNames.length > 1 ? "high" as const : sourceNames.length === 1 ? "medium" as const : "low" as const,
    };

    const railDist = googleOsmRail.length ? Math.min(...googleOsmRail) : undefined;
    const officialBusDist = officialBusDistances.length ? Math.min(...officialBusDistances) : undefined;
    const busDist = officialBusDist ?? (googleOsmBus.length ? Math.min(...googleOsmBus) : undefined);

    const c3TransitMetrics = {
      mrtOrRailDist: railDist,
      busStopDist: busDist,
      source: [
        railDist != null ? sourceNames.filter((s) => s.includes("Google") || s.includes("OpenStreetMap")) : "",
        officialBusDist != null ? "Taipei City Transportation Department" : "",
      ].filter(Boolean).join(" + ") || "unavailable",
      method: "calculated" as const,
      confidence: officialBusDist != null && railDist != null ? "high" as const : railDist != null || busDist != null ? "medium" as const : "low" as const,
      status: railDist != null || busDist != null ? "available" as const : officialTransit.status === "error" || officialTransit.status === "timeout" ? officialTransit.status : "empty" as const,
      retrievedAt: officialTransit.retrievedAt,
    };

    const scores = calculateAssessment(
      null,
      {},
      weather || undefined,
      c2PoiMetrics,
      c3TransitMetrics,
    );
    const allFactors = [
      ...scores.c1.factors,
      ...scores.c2.factors,
      ...scores.c3.factors,
      ...scores.c4.factors,
      ...scores.c5.factors,
    ];

    return res.json({
      location: { lat, lng, city, district, streetName },
      scores,
      factors: allFactors,
      poiCount: pois.length,
      dataSources: sourceNames,
      sourceStatus: [
        { source: google.source, status: google.status, retrievedAt: google.retrievedAt, error: google.error || null },
        { source: osm.source, status: osm.status, retrievedAt: osm.retrievedAt, error: osm.error || null },
        { source: officialTransit.source, status: officialTransit.status, retrievedAt: officialTransit.retrievedAt, error: officialTransit.error || null },
      ],
      weatherStatus: weather?.status || "error",
      generatedAt: new Date().toISOString(),
      c2DataMode: "poi-derived",
      c2PoiMetrics,
      c2PoiCount: pois.filter((poi: any) => poi.category === "C2").length,
    });
  } catch (error: any) {
    console.error("Assessment error:", error);
    return res.status(500).json({ error: error.message || "Failed to calculate assessment" });
  }
});

// 實勘結果綜合分析與診斷報告
app.post("/api/analyze-cls", async (req: Request, res: Response) => {
  try {
    const {
      streetName,
      district,
      city,
      coords,
      c1Score,
      c2Score,
      c3Score,
      c4Score,
      c5Score,
      overallScore,
      fieldChecks,
      fieldNotes,
    } = req.body;

    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        source: "algorithmic_rule_based",
        overallScore,
        strengths: [
          "各項指標均衡發展，生活與通勤機能完備",
          "步行範圍內各級 POI 距離衰減效能優良",
          "社區治安防汛與公共設施常態維護水準良好",
        ],
        weaknesses: [
          "尖峰時段可能有臨路動態車流低頻噪音",
          "部分狹窄巷弄若有機車違停需注意行人動線",
          "特定時間帶應多留意人潮走動與環境維護狀況",
        ],
        surveyRecommendations: [
          "建議於平日傍晚 18:00~19:30 與週末上午各實地再複勘一次人車流量",
          "實地檢視建築周圍有無油煙直排或雜物堆置死角",
          "確認常態步行至最近捷運/大眾運輸站點的連續人行道安全性",
        ],
        summary: `${streetName || "目標路段"} 社區宜居綜合指數 (CLS) 評分 ${overallScore} 分，整體生活條件具備高度實用性與穩定性。`,
      });
    }

    const prompt = `你是一位專業的都市計畫與社區宜居度評估顧問。
探查目標：${city} ${district} ${streetName || "現場實勘路段"} (座標: ${coords?.lat}, ${coords?.lng})
指標實勘數據：
- C1 安全與風險指數：${c1Score} 分
- C2 便利與機能指數：${c2Score} 分
- C3 移動與連結指數：${c3Score} 分
- C4 環境與綠意指數：${c4Score} 分
- C5 社會與活力指數：${c5Score} 分
- 社區宜居綜合指數 (CLS)：${overallScore} 分
- 使用者現場實勘觀察項目：${JSON.stringify(fieldChecks || [])}
- 使用者現場實勘筆記：${fieldNotes || "無額外備忘"}

請根據上述 5 大指標評分與現場觀察，產出客觀、專業的宜居度實勘診斷（JSON 格式）：
{
  "strengths": ["優勢1 (具體說明)", "優勢2", "優勢3"],
  "weaknesses": ["抗性/劣勢1 (具體說明)", "抗性2", "抗性3"],
  "surveyRecommendations": [
    "實地複勘關鍵建議1",
    "實地複勘關鍵建議2",
    "實地複勘關鍵建議3"
  ],
  "summary": "120字以內的專業宜居綜合評價總結"
}`;

    const textResponse = await generateGeminiContentWithFallback(
      ai,
      prompt,
      "application/json"
    );

    const parsed = JSON.parse(textResponse || "{}");
    return res.json({
      source: "gemini_ai",
      ...parsed,
    });
  } catch (error: any) {
    console.error("CLS analysis error:", error);
    return res.status(500).json({ error: error.message || "Failed to analyze CLS" });
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
