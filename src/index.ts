import { z } from 'zod';
import { categories, districts, publicColumns, reportSchema, reviewSchema, submissionSchema, venueColumns } from './schema';
import { HttpError, localDevelopment, rateLimit, readJson, requireAdmin, requireOrigin, securityHeaders, verifyTurnstile } from './security';
import type { Env } from './types';
import { validDate, retentionActive, registrationOpen } from './config';
import { beginGoogleLogin, finishGoogleLogin, googleLoginConfigured, limitMerchantSubmissions, logoutMerchant, merchantSession, requireMerchant } from './merchant-auth';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const now = () => new Date().toISOString();
async function intake(env: Env, kind: string) {
  const configured = Number(env.DAILY_SUBMISSION_LIMIT);
  const limit = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 1000) : 200;
  const result = await env.DB.prepare('INSERT INTO daily_intake(day,kind,count) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count')
    .bind(now().slice(0,10), kind, limit).first();
  if (!result) throw new HttpError(429, '今日登記或回報已達上限，請明日再試或聯絡主辦單位。');
}
async function publicVenues(req: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(req.url);
  const district = url.searchParams.get('district') || '';
  const category = url.searchParams.get('category') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Number(url.searchParams.get('page') || 1);
  const accessible = url.searchParams.get('accessible') === '1';
  if ((district && !districts.includes(district as typeof districts[number])) ||
    (category && !categories.includes(category as typeof categories[number])) || q.length > 60 || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw new HttpError(400, '查詢條件不正確。');
  }
  const canonical = new URL('/api/venues', env.SITE_ORIGIN);
  for (const [k,v] of Object.entries({ district, category, q, page: String(page), accessible: accessible ? '1' : '' })) if (v) canonical.searchParams.set(k,v);
  const key = new Request(canonical);
  const cache = typeof caches !== 'undefined' ? caches.default : undefined;
  const cached = await cache?.match(key); if (cached) return cached;
  const clauses = ["status='approved'"]; const values: (string|number)[] = [];
  if (district) { clauses.push('district=?'); values.push(district); }
  if (category) { clauses.push('category=?'); values.push(category); }
  if (accessible) clauses.push('accessible=1');
  if (q) {
    clauses.push("(name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')");
    const term = `%${q.replace(/[\\%_]/g, '\\$&')}%`; values.push(term,term);
  }
  const where = clauses.join(' AND ');
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT ${publicColumns} FROM venues WHERE ${where} ORDER BY created_at DESC,id LIMIT 24 OFFSET ?`).bind(...values,(page-1)*24),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM venues WHERE ${where}`).bind(...values)
  ]);
  const response = Response.json({ venues: results[0].results, total: (results[1].results[0] as {total:number}).total, page, page_size: 24 }, { headers: { 'Cache-Control': 'public, max-age=30' } });
  if (cache) ctx.waitUntil(cache.put(key,response.clone()));
  return response;
}
async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (!localDevelopment(req,env) && new URL(req.url).origin !== env.SITE_ORIGIN) throw new HttpError(403, '請使用網站正式網址。');
  const admin = path === '/admin' || path.startsWith('/admin/') || path === '/api/admin' || path.startsWith('/api/admin/');
  let actor = '';
  if (admin) actor = await requireAdmin(req,env);
  if (!path.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405,'不支援此操作。');
    const result = await env.ASSETS.fetch(req);
    const response = new Response(result.body,result);
    if (admin) { response.headers.set('Cache-Control','no-store'); response.headers.set('X-Robots-Tag','noindex, nofollow'); }
    return response;
  }
  if (req.method !== 'GET') requireOrigin(req,env);
  await rateLimit(req,env,req.method !== 'GET' || path==='/api/auth/callback');
  if(path==='/api/auth/login' && req.method==='POST') {
    z.object({}).strict().parse(await readJson(req));
    return beginGoogleLogin(req,env);
  }
  if(path==='/api/auth/callback' && req.method==='GET')return finishGoogleLogin(req,env);
  if(path==='/api/auth/logout' && req.method==='POST') {
    z.object({}).strict().parse(await readJson(req));
    return logoutMerchant(req,env);
  }
  if(path==='/api/auth/me' && req.method==='GET') {
    const user=await merchantSession(req,env);
    return json({user:user?{email:user.email,emailAuthoritative:!!user.email_authoritative,provider:user.identity_provider}:null});
  }
  if (path === '/api/config' && req.method === 'GET') return json({
    eventLabel: env.EVENT_LABEL, eventTime: env.EVENT_TIME, livestreamUrl: env.LIVESTREAM_URL,
    contactEmail: env.CONTACT_EMAIL, organizerName: env.ORGANIZER_NAME,
    deleteAfter: env.PRIVACY_DELETE_AFTER, registrationOpen: registrationOpen(env),
    googleLoginAvailable:googleLoginConfigured(req,env),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY, localDevelopment: localDevelopment(req,env), districts, categories
  });
  if (path === '/api/venues' && req.method === 'GET') return publicVenues(req,env,ctx);
  if (path === '/api/venues' && req.method === 'POST') {
    if (!registrationOpen(env)) throw new HttpError(403,'店家登記目前暫停受理。');
    const identity=await requireMerchant(req,env);
    const data = submissionSchema.parse(await readJson(req));
    if(data.contact_email!==identity.email)throw new HttpError(403,'聯絡 Email 必須使用目前登入的 Google 帳號。');
    await verifyTurnstile(req,env,data.turnstile_token,'register');
    await limitMerchantSubmissions(env,identity);
    await intake(env,'registration');
    const id = crypto.randomUUID(); const timestamp = now();
    const values = venueColumns.map(k => typeof data[k] === 'boolean' ? Number(data[k]) : data[k]);
    await env.DB.prepare(`INSERT INTO venues(id,${venueColumns.join(',')},consent_version,created_at,updated_at,owner_google_sub,owner_google_email,owner_email_authoritative,owner_verified_at,owner_identity_provider) VALUES(${Array(venueColumns.length+9).fill('?').join(',')})`)
      .bind(id,...values,'2026-11-26-google-v1',timestamp,timestamp,identity.google_sub,identity.email,identity.email_authoritative,identity.authenticated_at,identity.identity_provider).run();
    return json({ id, message: '已收到登記，主辦單位查核後才會公開。請保存登記編號。' },201);
  }
  if (path === '/api/reports' && req.method === 'POST') {
    if (!retentionActive(env)) throw new HttpError(403,'本活動已停止接受回報。');
    const data = reportSchema.parse(await readJson(req));
    await verifyTurnstile(req,env,data.turnstile_token,'report');
    const venue = await env.DB.prepare("SELECT id FROM venues WHERE id=? AND status='approved'").bind(data.venue_id).first();
    if (!venue) throw new HttpError(404,'找不到此場地。');
    await intake(env,'report');
    await env.DB.prepare('INSERT INTO reports(id,venue_id,reason,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),data.venue_id,data.reason,now()).run();
    return json({ message:'已收到回報，管理者會查核處理。' },201);
  }
  if (path === '/api/admin/venues' && req.method === 'GET') {
    const u = new URL(req.url); const status = u.searchParams.get('status') || 'pending';
    const page = Number(u.searchParams.get('page') || 1);
    if (!['pending','approved','rejected','withdrawn'].includes(status) || !Number.isInteger(page) || page < 1 || page > 1000) throw new HttpError(400,'查詢條件不正確。');
    const data = await env.DB.batch([
      env.DB.prepare('SELECT * FROM venues WHERE status=? ORDER BY created_at DESC,id LIMIT 30 OFFSET ?').bind(status,(page-1)*30),
      env.DB.prepare('SELECT COUNT(*) AS total FROM venues WHERE status=?').bind(status)
    ]);
    return json({ venues:data[0].results, total:(data[1].results[0] as {total:number}).total, page, actor });
  }
  const venueMatch = path.match(/^\/api\/admin\/venues\/([a-f0-9-]{36})$/);
  if (venueMatch && req.method === 'PATCH') {
    const data = reviewSchema.parse(await readJson(req));
    const id = venueMatch[1]; const stamp = now(); const auditId = crypto.randomUUID();
    const fields = data.venue ? venueColumns : [];
    const values = fields.map(k => typeof data.venue![k] === 'boolean' ? Number(data.venue![k]) : data.venue![k]);
    const changes = fields.map(k => `${k}=?`);
    // Audit INSERT and UPDATE share one D1 transaction. Both use the same version predicate.
    const result = await env.DB.batch([
      env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,detail,created_at) SELECT ?,?,?,?,?,? FROM venues WHERE id=? AND version=?')
        .bind(auditId,actor,`venue:${data.status}`,id,JSON.stringify({ fromVersion:data.version, edited:!!data.venue }),stamp,id,data.version),
      env.DB.prepare(`UPDATE venues SET ${[...changes,'status=?','moderation_note=?','updated_at=?','version=version+1'].join(',')} WHERE id=? AND version=?`)
        .bind(...values,data.status,data.moderation_note,stamp,id,data.version)
    ]);
    if (result[1].meta.changes !== 1) throw new HttpError(409,'資料已被其他管理者修改或刪除，請重新載入。');
    return json({ message:'已儲存。公開列表最多約 30 秒後更新。' });
  }
  if (venueMatch && req.method === 'DELETE') {
    const data = z.object({ version:z.number().int().positive() }).strict().parse(await readJson(req));
    const id = venueMatch[1];
    const result = await env.DB.batch([
      env.DB.prepare('INSERT INTO audit_log(id,actor,action,target_id,detail,created_at) SELECT ?,?,?,?,?,? FROM venues WHERE id=? AND version=?')
        .bind(crypto.randomUUID(),actor,'venue:delete',id,'{}',now(),id,data.version),
      env.DB.prepare('DELETE FROM venues WHERE id=? AND version=?').bind(id,data.version)
    ]);
    if (result[1].meta.changes !== 1) throw new HttpError(409,'資料已被修改或刪除，請重新載入。');
    return json({ message:'場地與聯絡資料已刪除；公開快取最多保留 30 秒。' });
  }
  if (path === '/api/admin/reports' && req.method === 'GET') {
    const result = await env.DB.prepare("SELECT reports.*,venues.name FROM reports JOIN venues ON venues.id=reports.venue_id WHERE reports.status='open' ORDER BY reports.created_at LIMIT 100").all();
    return json({ reports:result.results });
  }
  const reportMatch = path.match(/^\/api\/admin\/reports\/([a-f0-9-]{36})$/);
  if (reportMatch && req.method === 'PATCH') {
    const data = z.object({ resolution:z.string().trim().min(3).max(1000) }).strict().parse(await readJson(req));
    const result = await env.DB.batch([
      env.DB.prepare("INSERT INTO audit_log(id,actor,action,target_id,detail,created_at) SELECT ?,?,?,?,?,? FROM reports WHERE id=? AND status='open'")
        .bind(crypto.randomUUID(),actor,'report:resolve',reportMatch[1],'{}',now(),reportMatch[1]),
      env.DB.prepare("UPDATE reports SET status='resolved',resolution=?,resolved_at=? WHERE id=? AND status='open'").bind(data.resolution,now(),reportMatch[1])
    ]);
    if (result[1].meta.changes !== 1) throw new HttpError(409,'此回報已處理。');
    return json({ message:'回報已標記處理。' });
  }
  if (path === '/api/admin/audit' && req.method === 'GET') {
    const data = await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all();
    return json({ logs:data.results });
  }
  throw new HttpError(404,'找不到此功能。');
}
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    let response: Response;
    try { response = await route(req,env,ctx); }
    catch (error) {
      if (error instanceof z.ZodError) response = json({ error:'請檢查欄位內容。', fields:error.issues.map(i => ({ field:i.path.join('.'), message:i.message })) },400);
      else if (error instanceof HttpError) response = json({ error:error.message },error.status);
      else { const requestId = crypto.randomUUID(); console.error(JSON.stringify({ event:'request_failed',requestId })); response = json({ error:'服務暫時無法使用，請稍後再試。',requestId },503); }
    }
    const secured = new Response(response.body,response);
    for (const [k,v] of Object.entries(securityHeaders)) secured.headers.set(k,v);
    if (secured.status === 429) secured.headers.set('Retry-After','60');
    return secured;
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    const stamp = now();
    if (validDate(env.PRIVACY_DELETE_AFTER) && env.PRIVACY_DELETE_AFTER < stamp.slice(0,10)) {
      await env.DB.batch([env.DB.prepare('DELETE FROM reports'),env.DB.prepare('DELETE FROM venues'),env.DB.prepare('DELETE FROM audit_log'),env.DB.prepare('DELETE FROM merchant_sessions'),env.DB.prepare('DELETE FROM oauth_states'),env.DB.prepare('DELETE FROM daily_intake')]);
    }
    const epoch=Math.floor(Date.now()/1000);
    await env.DB.batch([env.DB.prepare('DELETE FROM merchant_sessions WHERE expires_at<=?').bind(epoch),env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(epoch)]);
    await env.DB.prepare("DELETE FROM daily_intake WHERE day < date('now','-7 days')").run();
  }
};
