import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const counts = new Map<string, number>();
let failure = false;
const server = createServer((req, res) => {
  const source = new URL(req.url!, 'http://localhost').searchParams.get('sourceKey')!;
  counts.set(source, (counts.get(source) || 0) + 1);
  assert.equal(req.headers.authorization, 'Bearer test-token');
  if (failure && source === 'taipei_street_lights') {
    res.writeHead(502, { 'Retry-After': '0.001', 'Content-Type': 'text/html' });
    res.end('<html>embedded-asset-' + 'x'.repeat(20000) + '</html>');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ snapshots: [{ sourceKey: source, changed: true }] }));
  }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
async function run() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/refresh-data.ts'], {
    env: { ...process.env, STREETLENS_REFRESH_URL: `http://127.0.0.1:${(address as any).port}`, STREETLENS_REFRESH_TOKEN: 'test-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { exit, output };
}
try {
  assert.equal((await run()).exit, 0);
  assert.equal(counts.size, 22);
  assert.ok(!counts.has('taipei_aed') && !counts.has('taipei_public_toilets'));
  counts.clear(); failure = true;
  const result = await run();
  assert.equal(result.exit, 1, 'required failures must still fail the action');
  assert.equal(counts.get('taipei_street_lights'), 3);
  assert.equal(counts.get('taipei_fire_stations'), 1, 'continue other sources after failure');
  assert.match(result.output, /HTTP 502/);
  assert.doesNotMatch(result.output, /embedded-asset|<html>/);
  const scheduled = readFileSync('.github/workflows/scheduled-data-refresh.yml', 'utf8');
  const manual = readFileSync('.github/workflows/data-refresh.yml', 'utf8');
  assert.match(scheduled, /schedule:/);
  assert.doesNotMatch(manual, /schedule:/);
  for (const workflow of [scheduled, manual]) {
    assert.match(workflow, /group: streetlens-data-refresh/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /run: npm ci/);
    assert.match(workflow, /secrets.STREETLENS_REFRESH_URL \|\| secrets.STREETLENS_BASE_URL/);
  }
  console.log('Refresh sources, bounded retries, required failure and compact HTTP diagnostics passed.');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
