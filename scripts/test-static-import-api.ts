import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const base = 'http://127.0.0.1:4189';
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: { ...process.env, PORT: '4189', NODE_ENV: 'production', DATABASE_URL: '', STREETLENS_REFRESH_TOKEN: 'local-test-token' },
  stdio: 'ignore',
});
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode != null) throw new Error('Test server exited before startup');
    try { if ([200, 503].includes((await fetch(base + '/api/health')).status)) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'API test server must start');
  for (const sourceKey of ['taipei_public_toilets', 'taipei_aed']) {
    const retired = await fetch(base + '/api/internal/refresh-data?sourceKey=' + sourceKey, {
      method: 'POST', headers: { Authorization: 'Bearer local-test-token' },
    });
    assert.equal(retired.status, 400, 'retired sources cannot trigger external or database work');
    assert.ok(!(await retired.json()).allowedSourceKeys.includes(sourceKey));
  }
  const url = base + '/api/internal/import-static-osm';
  const invalid = '{invalid json';
  const unauthorized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: invalid });
  assert.equal(unauthorized.status, 401, 'authentication runs before parsing import body');
  const wrongToken = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong-token', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(wrongToken.status, 401);
  const badExtract = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(badExtract.status, 400);
  assert.match((await badExtract.json()).error, /Invalid or empty/);
  const oversized = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ oversized: 'x'.repeat(8 * 1024 * 1024) }) });
  assert.equal(oversized.status, 413, 'import upload budget is enforced');
  console.log('Static import API checks passed: auth before parsing, invalid extract rejection, 8 MB payload limit.');
} finally {
  child.kill('SIGTERM');
}
