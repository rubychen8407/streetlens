import { randomBytes, createHash } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';

const SESSION = '__Host-streetlens-private';
const FLOW = '__Host-streetlens-login';
const sessions = new Map<string, { email: string; sub: string; expires: number }>();
const flows = new Map<string, { verifier: string; expires: number }>();
const attempts = new Map<string, { count: number; expires: number }>();
const token = () => randomBytes(32).toString('base64url');
function config() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  const legacyEmail = (process.env.STREETLENS_OWNER_EMAIL || '').trim().toLowerCase();
  const plural = process.env.STREETLENS_PRIVATE_EMAILS;
  const allowed = new Map<string, string>();
  let valid = true;
  try {
    const emails = (plural === undefined ? legacyEmail : plural).split(/[,\n]/).map(email => email.trim().toLowerCase()).filter(Boolean);
    if (!emails.length || emails.length > 100 || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Invalid whitelist');
    const pins = plural === undefined ? { [legacyEmail]: process.env.STREETLENS_OWNER_GOOGLE_SUB || '' }
      : JSON.parse(process.env.STREETLENS_PRIVATE_GOOGLE_SUBS || '{}');
    if (!pins || typeof pins !== 'object' || Array.isArray(pins)) throw new Error('Invalid subjects');
    const subjects = new Map<string, string>();
    for (const [email, sub] of Object.entries(pins)) {
      if (typeof sub !== 'string' || sub.length > 255) throw new Error('Invalid subject');
      const normalized = email.trim().toLowerCase();
      if (subjects.has(normalized) && subjects.get(normalized) !== sub) throw new Error('Conflicting subjects');
      subjects.set(normalized, sub);
    }
    for (const email of emails) {
      const sub = subjects.get(email) || '';
      if (!email.endsWith('@gmail.com') && !sub) throw new Error('External email requires subject');
      allowed.set(email, sub);
    }
  } catch { valid = false; allowed.clear(); }
  let origin = '';
  try { const url = new URL(process.env.STREETLENS_PUBLIC_ORIGIN || '');
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin;
  } catch { /* Unconfigured authentication denies all private access. */ }
  // Google is authoritative for Gmail. Other domains must also pin the stable Google subject.
  return { clientId, clientSecret, allowed, origin,
    enabled: Boolean(clientId && clientSecret && origin && valid && allowed.size) };
}
function allowedIdentity(c: ReturnType<typeof config>, email: string, sub: string) {
  return c.allowed.has(email) && (!c.allowed.get(email) || c.allowed.get(email) === sub);
}
function prune<T extends { expires: number }>(map: Map<string, T>, limit: number) {
  for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
  while (map.size >= limit) map.delete(map.keys().next().value!);
}
function cookie(req: Request, name: string) {
  return (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge });
}
function owner(req: Request) {
  const c = config(), key = cookie(req, SESSION), session = sessions.get(key);
  if (!c.enabled || !session || session.expires <= Date.now() || !allowedIdentity(c, session.email, session.sub)) {
    sessions.delete(key); return null;
  }
  return session;
}
export function requireHousingOwner(req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'private, no-store');
  if (!owner(req)) { res.status(401).json({ error: 'Private housing access required' }); return; }
  next();
}
export function registerPrivateHousingAuth(app: Express, fetcher: typeof fetch = fetch) {
  app.use('/api/private', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  app.get('/api/private/access', (req, res) => {
    const session = owner(req);
    res.json({ enabled: config().enabled, authorized: Boolean(session), expiresAt: session?.expires ?? null });
  });
  app.get('/api/private/google/login', (req, res) => {
    const c = config(); if (!c.enabled) { res.sendStatus(503); return; }
    prune(attempts, 128); const key = req.ip || 'unknown', attempt = attempts.get(key) || { count: 0, expires: Date.now() + 60000 };
    if (++attempt.count > 3) { res.set('Retry-After', '60'); res.sendStatus(429); return; } attempts.set(key, attempt);
    prune(flows, 32); flows.delete(cookie(req, FLOW));
    const state = token(), verifier = token(); flows.set(state, { verifier, expires: Date.now() + 5 * 60000 });
    setCookie(res, FLOW, state, 5 * 60000);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.origin + '/api/private/google/callback',
      response_type: 'code', scope: 'openid email', state, prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    res.redirect(url.toString());
  });
  app.get('/api/private/google/callback', async (req, res) => {
    const c = config(), state = typeof req.query.state === 'string' ? req.query.state : '';
    const flow = flows.get(state);
    setCookie(res, FLOW, '', 0);
    if (!c.enabled || !state || state !== cookie(req, FLOW) || !flow || flow.expires <= Date.now()
      || typeof req.query.code !== 'string' || req.query.code.length > 2048 || req.query.error) { res.sendStatus(401); return; }
    flows.delete(state); // Single-use before any upstream request; no callback replay.
    try {
      const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: req.query.code,
          client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.origin + '/api/private/google/callback',
          grant_type: 'authorization_code', code_verifier: flow.verifier }) });
      if (!response.ok) throw new Error('OAuth rejected');
      const credentials = await response.json();
      if (typeof credentials.access_token !== 'string' || credentials.token_type?.toLowerCase() !== 'bearer') throw new Error('Invalid credential');
      const identityResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', { redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + credentials.access_token } });
      if (!identityResponse.ok) throw new Error('Identity rejected');
      const identity = await identityResponse.json();
      if (identity.email_verified !== true || typeof identity.sub !== 'string' || !identity.sub
        || typeof identity.email !== 'string' || !allowedIdentity(c, identity.email.toLowerCase(), identity.sub)) {
        res.sendStatus(403); return;
      }
      sessions.delete(cookie(req, SESSION)); prune(sessions, 32);
      const sessionId = token(), expires = Date.now() + 60 * 60000;
      sessions.set(sessionId, { email: identity.email.toLowerCase(), sub: identity.sub, expires });
      setCookie(res, SESSION, sessionId, 60 * 60000);
      res.redirect(c.origin + '/');
    } catch { res.status(502).send('Google sign-in failed. Please retry.'); }
  });
  app.post('/api/private/logout', (req, res) => {
    if (!config().enabled || req.headers.origin !== config().origin) { res.sendStatus(403); return; }
    sessions.delete(cookie(req, SESSION)); setCookie(res, SESSION, '', 0); res.sendStatus(204);
  });
}
