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
];

async function requestRefresh(sourceKey: string): Promise<Response> {
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
      if (!retryable || attempt === maxAttempts) return response;

      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** (attempt - 1);

      console.warn(
        `Refresh source ${sourceKey} returned HTTP ${response.status}; retrying in ${delayMs}ms (${attempt}/${maxAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error: any) {
      if (error?.name === "AbortError" || attempt === maxAttempts) throw error;

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
    const response = await requestRefresh(sourceKey);
    const raw = await response.text();

    let payload: any;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(
        `Refresh endpoint returned non-JSON for ${sourceKey}: ${raw.slice(0, 1000)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Refresh endpoint for ${sourceKey} returned HTTP ${response.status}: ${raw.slice(0, 1000)}`,
      );
    }

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
    }, null, 2));
  } catch (error: any) {
    failedRequests.push(sourceKey);
    console.error(`Refresh source ${sourceKey} failed: ${error?.message || error}`);
  }
}

const changed = allSnapshots.filter((item: any) => item.changed).length;
const skipped = allSnapshots.filter((item: any) => item.skipped).length;
const errors = allSnapshots.filter((item: any) => item.error).length;

console.log(JSON.stringify({
  sourceCount: sourceKeys.length,
  completedSourceCount: sourceKeys.length - failedRequests.length,
  failedSources: failedRequests,
  snapshotCount: allSnapshots.length,
  changed,
  skipped,
  errors,
}, null, 2));

if (failedRequests.length > 0 || errors > 0) {
  console.error("One or more source refreshes failed; existing snapshots were preserved where available.");
  process.exitCode = 1;
}