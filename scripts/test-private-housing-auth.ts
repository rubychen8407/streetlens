import assert from 'node:assert/strict';
import express from 'express';
import { registerPrivateHousingAuth, requireHousingOwner } from '../privateHousingAuth';
const app = express(); let upstream = 0, privateReads = 0;
let identity = { sub: 'owner-sub', email: 'owner@gmail.com', email_verified: true };
let rejectUpstream = false;
registerPrivateHousingAuth(app, (async (url: any, options: any) => {
  ++upstream; assert.equal(options.redirect, 'error'); assert.ok(options.signal);
  if (rejectUpstream) throw new Error('Fixture outage');
  if (String(url).endsWith('/token')) {
    assert.ok(options.body.get('code_verifier')); assert.equal(options.body.get('client_secret'), 'fixture-secret');
    return Response.json({ access_token: 'fixture-access', token_type: 'Bearer' });
  }
  assert.equal(String(url), 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(options.headers.Authorization, 'Bearer fixture-access'); return Response.json(identity);
}) as typeof fetch);
app.get('/fixture/private', requireHousingOwner, (_req, res) => { ++privateReads; res.json({ private: true }); });
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const get = (path: string, cookie = '') => fetch(base + path, { redirect: 'manual', headers: { Cookie: cookie } });
async function start() {
  const login = await get('/api/private/google/login'); assert.equal(login.status, 302);
  const url = new URL(login.headers.get('location')!);
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
  const state = url.searchParams.get('state')!;
  const raw = login.headers.getSetCookie()[0]; assert.match(raw, /HttpOnly/); assert.match(raw, /Secure/); assert.match(raw, /SameSite=Lax/);
  return { state, cookie: raw.split(';')[0] };
}
try {
  delete process.env.STREETLENS_OWNER_EMAIL;
  assert.equal((await get('/api/private/google/login')).status, 503);
  assert.deepEqual(await (await get('/api/private/access')).json(), { enabled: false, authorized: false, expiresAt: null });
  assert.equal((await get('/fixture/private')).status, 401); assert.equal(privateReads, 0);
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'fixture-client'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'fixture-secret';
  process.env.STREETLENS_PUBLIC_ORIGIN = 'https://fixture.example'; process.env.STREETLENS_OWNER_EMAIL = 'owner@gmail.com';
  process.env.STREETLENS_OWNER_GOOGLE_SUB = 'owner-sub';
  const first = await start();
  assert.equal((await get('/api/private/google/callback?code=x&state=' + first.state)).status, 401);
  assert.equal(upstream, 0, 'wrong browser cannot trigger Google calls');
  identity.email = 'other@gmail.com';
  assert.equal((await get('/api/private/google/callback?code=x&state=' + first.state, first.cookie)).status, 403);
  assert.equal((await get('/api/private/google/callback?code=x&state=' + first.state, first.cookie)).status, 401, 'callback single-use');
  identity.email = 'owner@gmail.com'; identity.email_verified = false;
  const second = await start();
  assert.equal((await get('/api/private/google/callback?code=x&state=' + second.state, second.cookie)).status, 403);
  identity.email_verified = true;
  // Free a rate-limit slot for revocation/expiration fixtures without real waiting.
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  const third = await start();
  Date.now = realNow;
  const callback = await get('/api/private/google/callback?code=x&state=' + third.state, third.cookie);
  assert.equal(callback.status, 302); assert.equal(callback.headers.get('location'), 'https://fixture.example/');
  const session = callback.headers.getSetCookie().find(v => v.startsWith('__Host-streetlens-private='))!.split(';')[0];
  assert.equal(session.includes('owner'), false, 'cookie contains no identity or provider credentials');
  assert.equal((await get('/fixture/private', session)).status, 200);
  const status = await get('/api/private/access', session); assert.match(status.headers.get('cache-control')!, /no-store/);
  const statusBody = await status.json(); assert.equal(statusBody.authorized, true); assert.equal('email' in statusBody, false);
  assert.equal((await get('/fixture/private', session + 'tampered')).status, 401);
  assert.equal((await fetch(base + '/api/private/logout', { method: 'POST', headers: { Cookie: session, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await get('/fixture/private', session)).status, 200, 'cross-origin logout cannot revoke');
  assert.equal((await fetch(base + '/api/private/logout', { method: 'POST', headers: { Cookie: session, Origin: 'https://fixture.example' } })).status, 204);
  assert.equal((await get('/fixture/private', session)).status, 401);
  const fourth = await start();
  const refreshed = await get('/api/private/google/callback?code=x&state=' + fourth.state, fourth.cookie);
  const freshSession = refreshed.headers.getSetCookie().find(v => v.startsWith('__Host-streetlens-private='))!.split(';')[0];
  process.env.STREETLENS_OWNER_GOOGLE_SUB = 'different-sub';
  assert.equal((await get('/fixture/private', freshSession)).status, 401, 'changed whitelist revokes existing session');
  process.env.STREETLENS_OWNER_GOOGLE_SUB = 'owner-sub';
  const fifth = await start();
  const expiring = await get('/api/private/google/callback?code=x&state=' + fifth.state, fifth.cookie);
  const expiringSession = expiring.headers.getSetCookie().find(v => v.startsWith('__Host-streetlens-private='))!.split(';')[0];
  try { Date.now = () => realNow() + 3600001;
    assert.equal((await get('/fixture/private', expiringSession)).status, 401, 'expired session rejected');
  } finally { Date.now = realNow; }
  assert.equal((await get('/api/private/google/login')).status, 429, 'bounded login attempts');
  process.env.STREETLENS_OWNER_EMAIL = 'owner@third-party.example'; delete process.env.STREETLENS_OWNER_GOOGLE_SUB;
  assert.equal((await get('/api/private/google/login')).status, 503, 'third-party email requires stable subject');
  process.env.STREETLENS_OWNER_EMAIL = 'owner@gmail.com';
  Date.now = () => realNow() + 180000;
  const failed = await start(); Date.now = realNow; rejectUpstream = true;
  assert.equal((await get('/api/private/google/callback?code=x&state=' + failed.state, failed.cookie)).status, 502);
  assert.equal((await get('/api/private/google/callback?code=x&state=' + failed.state, failed.cookie)).status, 401);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
console.log('Private housing auth passed: fail-closed configuration, Google-only exchange, PKCE/state/browser binding, owner whitelist, verified identity, replay rejection, private cache policy, tamper/revocation, CSRF logout and rate limits.');
