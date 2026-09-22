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

const timeoutMs = Number(process.env.STREETLENS_REFRESH_TIMEOUT_MS || 120_000);
const maxAttempts = 4;

async function requestRefresh(attempt: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(refreshUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error: any) {
    if (attempt >= maxAttempts) throw error;
    const delayMs = 500 * 2 ** (attempt - 1);
    console.warn(`Refresh request failed (attempt ${attempt}/${maxAttempts}): ${error?.message || error}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return requestRefresh(attempt + 1);
  } finally {
    clearTimeout(timeoutId);
  }
}

let response: Response;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  response = await requestRefresh(attempt);

  if (response.ok) break;

  const body = await response.text();
  const retryable = response.status === 429 || response.status >= 500;

  if (!retryable || attempt === maxAttempts) {
    throw new Error(
      `Refresh endpoint returned HTTP ${response.status}: ${body.slice(0, 1000)}`,
    );
  }

  const retryAfter = Number(response.headers.get("retry-after"));
  const delayMs = Number.isFinite(retryAfter)
    ? Math.max(0, retryAfter * 1000)
    : 500 * 2 ** (attempt - 1);

  console.warn(
    `Refresh endpoint returned HTTP ${response.status}; retrying in ${delayMs}ms (${attempt}/${maxAttempts})`,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const raw = await response!.text();
let payload: any;
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  throw new Error(`Refresh endpoint returned non-JSON response: ${raw.slice(0, 1000)}`);
}

if (!response!.ok) {
  throw new Error(`Refresh endpoint returned HTTP ${response!.status}`);
}

const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
const changed = snapshots.filter((item: any) => item.changed).length;
const skipped = snapshots.filter((item: any) => item.skipped).length;
const errors = snapshots.filter((item: any) => item.error).length;

console.log(JSON.stringify({
  refreshedAt: payload.refreshedAt ?? null,
  targetCount: payload.targetCount ?? null,
  snapshotCount: snapshots.length,
  changed,
  skipped,
  errors,
}, null, 2));

if (errors > 0) {
  console.error("One or more source refreshes failed; existing snapshots were preserved where available.");
  process.exitCode = 1;
}
