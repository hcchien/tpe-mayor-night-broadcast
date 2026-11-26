import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './types';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function localDevelopment(req: Request, env: Env) {
  const u = new URL(req.url);
  return env.ENVIRONMENT === 'development' && env.LOCAL_DEV_AUTH === 'true' &&
    u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
}
export function requireOrigin(req: Request, env: Env) {
  if (req.headers.get('Origin') !== env.SITE_ORIGIN || new URL(req.url).origin !== env.SITE_ORIGIN) {
    throw new HttpError(403, '請從本站重新操作。');
  }
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '僅接受 JSON 資料。');
  }
}
export async function readJson(req: Request): Promise<unknown> {
  const max = 16_384;
  if (Number(req.headers.get('Content-Length') || 0) > max) throw new HttpError(413, '資料超過大小限制。');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少資料。');
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw new HttpError(413, '資料超過大小限制。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new HttpError(400, '資料格式不正確。'); }
}
const jwks = new Map<string, JWTVerifyGetKey>();
export async function verifyAdminToken(token: string, env: Env, keys?: JWTVerifyGetKey) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD || !env.ADMIN_EMAILS) {
    throw new HttpError(503, '管理者登入尚未設定。');
  }
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keys) {
    keys = jwks.get(issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); jwks.set(issuer, keys); }
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp','iat','sub','email']
    });
    const email = String(payload.email).toLowerCase();
    const allowed = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(email)) throw new Error('not allowed');
    return email;
  } catch { throw new HttpError(403, '登入已失效或沒有管理權限，請重新登入。'); }
}
export async function requireAdmin(req: Request, env: Env) {
  if (localDevelopment(req, env)) return 'local-admin@example.com';
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, '請先透過 Cloudflare Access 登入。');
  return verifyAdminToken(token, env);
}
export async function rateLimit(req: Request, env: Env, write: boolean) {
  if (localDevelopment(req, env)) return;
  const binding = write ? env.WRITE_LIMITER : env.READ_LIMITER;
  const ip = req.headers.get('CF-Connecting-IP');
  if (!binding || !ip || !env.IP_HASH_SECRET || env.IP_HASH_SECRET.length < 32) throw new HttpError(503, '安全服務尚未就緒。');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.IP_HASH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${new Date().toISOString().slice(0,10)}:${ip}`));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
  const { success } = await binding.limit({ key: hash });
  if (!success) throw new HttpError(429, '操作太頻繁，請稍候一分鐘再試。');
}
export async function verifyTurnstile(req: Request, env: Env, token: string, action: string) {
  if (localDevelopment(req, env)) return;
  if (!env.TURNSTILE_SECRET_KEY || env.TURNSTILE_SECRET_KEY.startsWith('1x000') || env.TURNSTILE_SECRET_KEY.startsWith('2x000')) {
    throw new HttpError(503, '驗證服務尚未設定。');
  }
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: req.headers.get('CF-Connecting-IP') }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error('siteverify');
    result = await res.json();
  } catch { throw new HttpError(503, '驗證服務暫時無法使用，請稍後再試。'); }
  if (!result.success || result.hostname !== new URL(env.SITE_ORIGIN).hostname || result.action !== action) {
    throw new HttpError(400, '人機驗證已失效，請重新驗證。');
  }
}
export const securityHeaders: Record<string,string> = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
