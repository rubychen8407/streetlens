import { fetchTaipeiGreenData, GREEN_RESOURCE_URLS } from "../green";
import { fetchTaiwanTransitData } from "../transit";
import { fetchTaipeiSafetyData, SAFETY_RESOURCE_URLS } from "../safety";

const TEST_LAT = Number(process.env.STREETLENS_TEST_LAT || "25.033964");
const TEST_LNG = Number(process.env.STREETLENS_TEST_LNG || "121.564468");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkHttpResource(url: string): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "StreetLens/1.0" },
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) throw new Error(`${url} returned an empty body`);
  console.log(`OK ${url} (${body.byteLength} bytes)`);
}

async function main() {
  console.log(`External data health check at ${TEST_LAT},${TEST_LNG}`);

  await Promise.all([
    ...Object.values(GREEN_RESOURCE_URLS),
    ...Object.values(SAFETY_RESOURCE_URLS),
  ].map(checkHttpResource));

  const [green, transit, safety] = await Promise.all([
    fetchTaipeiGreenData(TEST_LAT, TEST_LNG),
    fetchTaiwanTransitData(TEST_LAT, TEST_LNG),
    fetchTaipeiSafetyData(TEST_LAT, TEST_LNG, 500),
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

  console.log("External data health check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
