import { fetchTaipeiGreenData, GREEN_RESOURCE_URLS } from "../green";
import { fetchTaiwanTransitData } from "../transit";
import { fetchTaipeiSafetyData, SAFETY_RESOURCE_URLS } from "../safety";
import {
  OFFICIAL_SOURCE_URLS,
  fetchTaipeiYouBikeData,
  fetchTaipeiMedicalFacilities,
  fetchTaipeiStreetLights,
  fetchTaipeiBusStops,
  fetchTaipeiLibraries,
  fetchTaipeiPublicToilets,
  fetchTaipeiParks,
  fetchTaipeiBikeLanes,
  fetchTaipeiSidewalkAreas,
} from "../official";

const TEST_LAT = Number(process.env.STREETLENS_TEST_LAT || "25.033964");
const TEST_LNG = Number(process.env.STREETLENS_TEST_LNG || "121.564468");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface HttpResourceResult {
  url: string;
  status: "ok" | "empty" | "timeout" | "error";
  httpStatus?: number;
  bytes?: number;
  error?: string;
}

async function checkHttpResource(url: string): Promise<HttpResourceResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "StreetLens/1.0" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { url, status: "error", httpStatus: response.status, error: `HTTP ${response.status}` };
    }

    const body = await response.arrayBuffer();
    if (body.byteLength === 0) {
      return { url, status: "empty", httpStatus: response.status, bytes: 0 };
    }

    return { url, status: "ok", httpStatus: response.status, bytes: body.byteLength };
  } catch (error: any) {
    return {
      url,
      status: error?.name === "AbortError" ? "timeout" : "error",
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  console.log(`External data health check at ${TEST_LAT},${TEST_LNG}`);

  const resourceResults = await Promise.all([
    ...Object.values(GREEN_RESOURCE_URLS),
    ...Object.values(SAFETY_RESOURCE_URLS),
    OFFICIAL_SOURCE_URLS.taipeiYouBike,
    OFFICIAL_SOURCE_URLS.taipeiClinics,
    OFFICIAL_SOURCE_URLS.taipeiHospitals,
    OFFICIAL_SOURCE_URLS.taipeiStreetLights,
    OFFICIAL_SOURCE_URLS.taipeiBusStops,
    OFFICIAL_SOURCE_URLS.taipeiLibraries,
    OFFICIAL_SOURCE_URLS.taipeiPublicToilets,
    OFFICIAL_SOURCE_URLS.taipeiParks,
    OFFICIAL_SOURCE_URLS.taipeiBikeLanes,
    OFFICIAL_SOURCE_URLS.wheelRouteFacility11,
    OFFICIAL_SOURCE_URLS.wheelRouteFacility12,
  ].map(checkHttpResource));

  for (const result of resourceResults) {
    if (result.status === "ok") {
      console.log(`OK ${result.url} (${result.bytes ?? 0} bytes)`);
    } else {
      console.error(`RESOURCE ${result.status.toUpperCase()} ${result.url}${result.httpStatus ? ` HTTP ${result.httpStatus}` : ""}${result.error ? `: ${result.error}` : ""}`);
    }
  }

  // Resource probes are diagnostic only. The adapters below perform the real
  // end-to-end fetch + parse checks and are the authoritative health signal.
  // Some data.taipei CSV endpoints can reject/timeout generic CI fetches even
  // though the adapter request succeeds, so do not fail before exercising it.

  const [green, transit, safety, youBike, medical, streetLights, busStops, libraries, publicToilets, parks, bikeLanes, sidewalks] = await Promise.all([
    fetchTaipeiGreenData(TEST_LAT, TEST_LNG),
    fetchTaiwanTransitData(TEST_LAT, TEST_LNG),
    fetchTaipeiSafetyData(TEST_LAT, TEST_LNG, 500),
    fetchTaipeiYouBikeData(),
    fetchTaipeiMedicalFacilities(),
    fetchTaipeiStreetLights(),
    fetchTaipeiBusStops(),
    fetchTaipeiLibraries(),
    fetchTaipeiPublicToilets(),
    fetchTaipeiParks(),
    fetchTaipeiBikeLanes(),
    fetchTaipeiSidewalkAreas(),
  ]);

  console.log(JSON.stringify({
    green: {
      status: green.status,
      source: green.source,
      retrievedAt: green.retrievedAt,
      streetTreeCount: green.streetTrees.length,
      parkTreeCount: green.parkTrees.length,
      error: green.error || null,
    },
    transit: {
      status: transit.status,
      source: transit.source,
      retrievedAt: transit.retrievedAt,
      busStopCount: transit.stops.length,
      railStationCount: transit.railStations.length,
      error: transit.error || null,
    },
    safety: {
      status: safety.status,
      source: safety.source,
      retrievedAt: safety.retrievedAt,
      accidentCount500m: safety.accidents.length,
      error: safety.error || null,
    },
    official: {
      youBike: { status: youBike.status, points: youBike.points.length, error: youBike.error || null },
      medical: { status: medical.status, points: medical.points.length, error: medical.error || null },
      streetLights: { status: streetLights.status, points: streetLights.points.length, error: streetLights.error || null },
      busStops: { status: busStops.status, points: busStops.points.length, error: busStops.error || null },
      libraries: { status: libraries.status, points: libraries.points.length, error: libraries.error || null },
      publicToilets: { status: publicToilets.status, points: publicToilets.points.length, error: publicToilets.error || null },
      parks: { status: parks.status, points: parks.points.length, error: parks.error || null },
      bikeLanes: { status: bikeLanes.status, lines: bikeLanes.lines?.length || 0, error: bikeLanes.error || null },
      sidewalks: { status: sidewalks.status, areas: sidewalks.areas?.length || 0, error: sidewalks.error || null },
    },
  }, null, 2));

  // "empty" is a valid real-data outcome. HTTP/parser failures are not.
  assert(green.status !== "error" && green.status !== "timeout",
    `Taipei green data source failed: ${green.error || green.status}`);
  assert(transit.status !== "error" && transit.status !== "timeout",
    `TDX transit source failed: ${transit.error || transit.status}`);
  assert(safety.status !== "error" && safety.status !== "timeout",
    `Taipei safety data source failed: ${safety.error || safety.status}`);

  assert(Array.isArray(green.streetTrees) && Array.isArray(green.parkTrees),
    "Green adapter returned invalid arrays");
  assert(Array.isArray(transit.stops) && Array.isArray(transit.railStations),
    "Transit adapter returned invalid arrays");
  assert(Array.isArray(safety.accidents),
    "Safety adapter returned invalid accidents array");

  const officialResults = [
    ["YouBike", youBike],
    ["medical", medical],
    ["streetLights", streetLights],
    ["busStops", busStops],
    ["libraries", libraries],
    ["publicToilets", publicToilets],
    ["parks", parks],
    ["bikeLanes", bikeLanes],
    ["sidewalks", sidewalks],
  ] as const;

  for (const [name, result] of officialResults) {
    assert(result.status !== "error" && result.status !== "timeout",
      `${name} official source failed: ${result.error || result.status}`);
  }

  assert(Array.isArray(youBike.points), "YouBike adapter returned invalid points");
  assert(Array.isArray(medical.points), "Medical adapter returned invalid points");
  assert(Array.isArray(streetLights.points), "Street light adapter returned invalid points");
  assert(Array.isArray(busStops.points), "Bus stop adapter returned invalid points");
  assert(Array.isArray(libraries.points), "Library adapter returned invalid points");
  assert(Array.isArray(publicToilets.points), "Public toilet adapter returned invalid points");
  assert(Array.isArray(parks.points), "Park adapter returned invalid points");
  assert(Array.isArray(bikeLanes.lines), "Bike lane adapter returned invalid lines");
  assert(Array.isArray(sidewalks.areas), "Sidewalk adapter returned invalid areas");

  console.log("External data health check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
