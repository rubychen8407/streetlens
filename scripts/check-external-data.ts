import { fetchTaipeiGreenData, GREEN_RESOURCE_URLS } from "../green";
import { fetchTaiwanTransitData } from "../transit";

const TEST_LAT = Number(process.env.STREETLENS_TEST_LAT || "25.033964");
const TEST_LNG = Number(process.env.STREETLENS_TEST_LNG || "121.564468");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function checkHttpResource(url: string): Promise<void> {\n  const response = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "StreetLens/1.0" } });\n  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);\n  const body = await response.arrayBuffer();\n  if (body.byteLength === 0) throw new Error(`${url} returned an empty body`);\n  console.log(`OK ${url} (${body.byteLength} bytes)`);\n}\n\nasync function main() {
  console.log(`External data health check at ${TEST_LAT},${TEST_LNG}`);

  await Promise.all(Object.values(GREEN_RESOURCE_URLS).map(checkHttpResource));\n\n  const [green, transit] = await Promise.all([
    fetchTaipeiGreenData(TEST_LAT, TEST_LNG),
    fetchTaiwanTransitData(TEST_LAT, TEST_LNG),
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
  }, null, 2));

  // "empty" is a valid real-data outcome. HTTP/parser failures are not.
  assert(green.status !== "error" && green.status !== "timeout",
    `Taipei green data source failed: ${green.error || green.status}`);
  assert(transit.status !== "error" && transit.status !== "timeout",
    `TDX transit source failed: ${transit.error || transit.status}`);

  assert(Array.isArray(green.streetTrees) && Array.isArray(green.parkTrees),
    "Green adapter returned invalid arrays");
  assert(Array.isArray(transit.stops) && Array.isArray(transit.railStations),
    "Transit adapter returned invalid arrays");

  console.log("External data health check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
