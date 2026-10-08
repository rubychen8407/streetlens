import process from "node:process";

const baseUrl = process.env.STREETLENS_REFRESH_URL || process.env.STREETLENS_BASE_URL;
const token = process.env.STREETLENS_REFRESH_TOKEN;

if (!baseUrl) {
  throw new Error("STREETLENS_REFRESH_URL or STREETLENS_BASE_URL is required");
}
if (!token) {
  throw new Error("STREETLENS_REFRESH_TOKEN is required");
}

const normalizedUrl = baseUrl.endsWith("/")
  ? baseUrl.slice(0, -1)
  : baseUrl;
const refreshUrl = normalizedUrl.endsWith("/api/internal/refresh-data")
  ? normalizedUrl
  : normalizedUrl + "/api/internal/refresh-data";

const timeoutMs = Number(process.env.STREETLENS_REFRESH_TIMEOUT_MS || 300_000);
const maxAttempts = 3;
const sourceKeys = [
  "google_places",
  "openstreetmap",
  "tdx_transit",
  "taipei_green",
  "taipei_safety",
  "taipei_flood",
  "open_meteo_air_quality",
  "taipei_historical_flood",
  "taipei_youbike",
  "taipei_medical",
  "taipei_street_lights",
  "taipei_bus_stops",
  "taipei_mrt_stations",
  "taipei_libraries",
  "taipei_parks",
  "taipei_bike_lanes",
  "taipei_sidewalk_areas",
  "taipei_markets",
  "taipei_cooling_points",
  "taipei_fire_hydrants",
  "taipei_official_aqi",
  "taipei_fire_stations",
];
// These supplementary feeds can fail independently; the API preserves their
// last good snapshots while the rest of the refresh continues.
const optionalSourceKeys = new Set(["taipei_parks", "taipei_official_aqi"]);

async function requestRefresh(sourceKey: string): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        refreshUrl + "?sourceKey=" + encodeURIComponent(sourceKey),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        },
      );

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxAttempts) {
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : (response.status === 502 || response.status === 503 ? 5000 : 1000) * 2 ** (attempt - 1);
        console.warn(`Refresh source ${sourceKey} returned HTTP ${response.status}; retrying in ${delayMs}ms (${attempt}/${maxAttempts})`);
        clearTimeout(timeoutId);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      if (!response.ok) {
        // Do not download potentially huge proxy HTML/error assets.
        await response.body?.cancel();
        throw Object.assign(new Error(`Refresh endpoint for ${sourceKey} returned HTTP ${response.status}`), { terminal: true });
      }
      // The timeout covers reading/parsing the body, not only response headers.
      const payload = await response.json();
      if (!Array.isArray(payload?.snapshots) || (!payload.snapshots.length && payload.targetCount !== 0)) {
        throw Object.assign(new Error(`Refresh endpoint for ${sourceKey} returned no snapshot results`), { terminal: true });
      }
      const transient = payload.snapshots.filter((item: any) => item.error
        && (item.status === 'timeout' || (item.status === 'error' && /fetch failed|network|ECONNRESET|ETIMEDOUT|HTTP (429|5[0-9]{2})/i.test(String(item.error)))));
      if (transient.length && attempt < maxAttempts) {
        console.warn(`Refresh source ${sourceKey} reported a transient source failure; retrying (${attempt}/${maxAttempts}): ${String(transient[0].error).slice(0, 300)}`);
        clearTimeout(timeoutId);
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      return payload;
    } catch (error: any) {
      if (error?.terminal || error?.name === "AbortError" || attempt === maxAttempts) throw error;

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `Refresh source ${sourceKey} failed (${attempt}/${maxAttempts}): ${error?.message || error}; retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error("Refresh request attempts exhausted");
}

const allSnapshots: any[] = [];
const failedRequests: string[] = [];

for (const sourceKey of sourceKeys) {
  try {
    const payload = await requestRefresh(sourceKey);

    const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
    allSnapshots.push(...snapshots);
    console.log(JSON.stringify({
      sourceKey,
      refreshedAt: payload.refreshedAt ?? null,
      targetCount: payload.targetCount ?? null,
      snapshotCount: snapshots.length,
      changed: snapshots.filter((item: any) => item.changed).length,
      skipped: snapshots.filter((item: any) => item.skipped).length,
      errors: snapshots.filter((item: any) => item.error).length,
      failures: snapshots.filter((item: any) => item.error).map((item: any) => ({
        scopeKey: item.scopeKey, status: item.status,
        error: String(item.error).slice(0, 300), preservedExisting: item.preservedExisting,
      })),
    }, null, 2));
  } catch (error: any) {
    failedRequests.push(sourceKey);
    console.error(`Refresh source ${sourceKey} failed: ${error?.message || error}`);
  }
}

const changed = allSnapshots.filter((item: any) => item.changed).length;
const skipped = allSnapshots.filter((item: any) => item.skipped).length;
const errors = allSnapshots.filter((item: any) => item.error).length;
const blockingErrors = allSnapshots.filter((item: any) =>
  item.error && !optionalSourceKeys.has(item.sourceKey),
);
const degradedSources = [...new Set(allSnapshots
  .filter((item: any) => item.error && optionalSourceKeys.has(item.sourceKey))
  .map((item: any) => item.sourceKey))];

console.log(JSON.stringify({
  sourceCount: sourceKeys.length,
  completedSourceCount: sourceKeys.length - failedRequests.length,
  failedSources: failedRequests,
  snapshotCount: allSnapshots.length,
  changed,
  skipped,
  errors,
  degradedSources,
}, null, 2));

if (failedRequests.length > 0 || blockingErrors.length > 0) {
  console.error("One or more required source refreshes failed; existing snapshots were preserved where available.");
  process.exitCode = 1;
} else if (degradedSources.length > 0) {
  console.warn("Refresh completed with optional sources degraded; their existing snapshots were preserved where available.");
}
