import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Env } from './types';
import { HttpError, localDevelopment } from './security';
import { registrationOpen, retentionActive } from './config';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SESSION_SECONDS = 12 * 60 * 60;
const FLOW_SECONDS = 600;
const seconds = () => Math.floor(Date.now()/1000);
export interface MerchantIdentity {
  google_sub: string;
  email: string;
  email_authoritative: number;
  identity_provider: 'google' | 'local';
  authenticated_at: string;
}
function randomToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function hashToken(value: string) {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
function cookieName(req: Request, env: Env, purpose: 'session' | 'oauth') {
  return `${localDevelopment(req,env)?'':'__Host-'}night-${purpose}`;
}
function readCookie(req: Request, name: string) {
  const matches=(req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  if(matches.length!==1) return null; // Reject ambiguous cookies instead of choosing an attacker-controlled value.
  const token=matches[0].slice(name.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
function cookie(req: Request, env: Env, purpose: 'session' | 'oauth', token: string, maxAge: number) {
  return `${cookieName(req,env,purpose)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${localDevelopment(req,env)?'':'; Secure'}`;
}
function response(data: unknown) { return Response.json(data,{headers:{'Cache-Control':'no-store'}}); }
export function googleLoginConfigured(req: Request, env: Env) {
  return localDevelopment(req,env) || (!!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') && !!env.GOOGLE_CLIENT_SECRET);
}
export async function verifyGoogleIdentity(idToken: string, env: Env, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<MerchantIdentity> {
  try {
    if(!env.GOOGLE_CLIENT_ID || !nonce) throw new Error('missing config');
    const {payload} = await jwtVerify(idToken,keys,{
      algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,
      requiredClaims:['sub','email','email_verified','iat','exp','nonce'],maxTokenAge:'10m'
    });
    if(payload.nonce!==nonce || payload.email_verified!==true ||
      typeof payload.sub!=='string' || !payload.sub || payload.sub.length>255 ||
      (payload.azp!==undefined && payload.azp!==env.GOOGLE_CLIENT_ID) ||
      (Array.isArray(payload.aud) && payload.aud.length>1 && payload.azp!==env.GOOGLE_CLIENT_ID)) throw new Error('invalid identity');
    const email=z.email().max(254).parse(payload.email).toLowerCase();
    // Non-Gmail accounts without hd are Google accounts, but Google is not authoritative
    // for continuing ownership of their third-party mailbox. Preserve that distinction.
    const authoritative=email.endsWith('@gmail.com') || (typeof payload.hd==='string' && payload.hd.length>0);
    return {google_sub:payload.sub,email,email_authoritative:Number(authoritative),identity_provider:'google',authenticated_at:new Date().toISOString()};
  } catch { throw new HttpError(401,'Google 身分驗證失敗，請重新登入。'); }
}
export async function merchantSession(req: Request, env: Env, forAdmin = false): Promise<MerchantIdentity | null> {
  if(!forAdmin && !retentionActive(env))return null;
  const token=readCookie(req,cookieName(req,env,'session'));if(!token)return null;
  const identity=await env.DB.prepare('SELECT google_sub,email,email_authoritative,identity_provider,authenticated_at FROM merchant_sessions WHERE token_hash=? AND expires_at>?')
    .bind(await hashToken(token),seconds()).first<MerchantIdentity>();
  if(identity?.identity_provider==='local' && !localDevelopment(req,env))return null;
  return identity;
}
export async function requireMerchant(req: Request, env: Env) {
  const identity=await merchantSession(req,env);
  if(!identity)throw new HttpError(401,'請先使用 Google 帳號登入，再送出店家登記。');
  return identity;
}
async function setSession(req: Request, env: Env, identity: MerchantIdentity, res: Response) {
  const token=randomToken();const previous=readCookie(req,cookieName(req,env,'session'));
  const statements=[];
  if(previous)statements.push(env.DB.prepare('DELETE FROM merchant_sessions WHERE token_hash=?').bind(await hashToken(previous)));
  statements.push(env.DB.prepare('INSERT INTO merchant_sessions(token_hash,google_sub,email,email_authoritative,identity_provider,authenticated_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .bind(await hashToken(token),identity.google_sub,identity.email,identity.email_authoritative,identity.identity_provider,identity.authenticated_at,seconds()+SESSION_SECONDS));
  await env.DB.batch(statements);
  res.headers.append('Set-Cookie',cookie(req,env,'session',token,SESSION_SECONDS));
  return res;
}
export async function beginGoogleLogin(req: Request, env: Env, admin = false) {
  if(!admin && !registrationOpen(env))throw new HttpError(403,'店家登記目前暫停受理。');
  if(!googleLoginConfigured(req,env))throw new HttpError(503,'Google 登入尚未設定。');
  if(localDevelopment(req,env)) {
    return setSession(req,env,{google_sub:'local-test-merchant',email:'merchant@example.com',email_authoritative:0,identity_provider:'local',authenticated_at:new Date().toISOString()},response({url:admin?'/admin/':'/#register'}));
  }
  // Global bound on state/session creation; per-IP write rate limit runs before this handler.
  const budget=await env.DB.prepare("INSERT INTO daily_intake(day,kind,count) VALUES(?,'oauth_login',1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 WHERE count<2000 RETURNING count")
    .bind(new Date().toISOString().slice(0,10)).first();
  if(!budget)throw new HttpError(429,'今日登入次數已達上限，請聯絡主辦單位。');
  const state=randomToken(),browser=randomToken(),nonce=randomToken(),verifier=randomToken();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,browser_hash,nonce,code_verifier,expires_at,admin_login) VALUES(?,?,?,?,?,?)')
    .bind(await hashToken(state),await hashToken(browser),nonce,verifier,seconds()+FLOW_SECONDS,Number(admin)).run();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.SITE_ORIGIN+'/api/auth/callback',
    response_type:'code',scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  const res=response({url:url.href});res.headers.append('Set-Cookie',cookie(req,env,'oauth',browser,FLOW_SECONDS));return res;
}
export async function consumeOAuthState(req: Request, env: Env) {
  const params=new URL(req.url).searchParams;
  const state=params.get('state');const browser=readCookie(req,cookieName(req,env,'oauth'));
  if(params.getAll('state').length!==1 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser)throw new HttpError(400,'登入請求無效或已過期。');
  // DELETE RETURNING is atomic: even simultaneous callback replay can consume the state only once.
  const flow=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING nonce,code_verifier,admin_login')
    .bind(await hashToken(state),await hashToken(browser),seconds()).first<{nonce:string;code_verifier:string;admin_login:number}>();
  if(!flow)throw new HttpError(400,'登入請求無效或已過期。');
  return flow;
}
export async function finishGoogleLogin(req: Request, env: Env) {
  let admin = false;
  const redirect=(error?:string)=>new Response(null,{status:303,headers:{Location:env.SITE_ORIGIN+(admin?(error?'/login-admin.html?login_error='+error:'/admin/'):'/'+(error?'?login_error='+error:'')+'#register'),'Cache-Control':'no-store'}});
  let res:Response;
  try {
    if(!googleLoginConfigured(req,env))throw new HttpError(503,'登入暫停');
    const flow=await consumeOAuthState(req,env);admin=flow.admin_login===1;
    if(!admin && !registrationOpen(env))throw new HttpError(503,'登入暫停');
    const params=new URL(req.url).searchParams;
    if(params.has('error'))res=redirect('cancelled');
    else {
      const code=params.get('code');const issuer=params.get('iss');
      if(params.getAll('code').length!==1 || !code || code.length>4096 || (issuer && issuer!=='https://accounts.google.com'))throw new HttpError(400,'登入回應無效');
      let idToken:string;
      try {
        const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.SITE_ORIGIN+'/api/auth/callback',grant_type:'authorization_code',code_verifier:flow.code_verifier}),signal:AbortSignal.timeout(8000)});
        if(!tokenResponse.ok)throw new Error('exchange failed');
        const tokens=await tokenResponse.json() as {id_token?:string};
        if(typeof tokens.id_token!=='string'||tokens.id_token.length>16384)throw new Error('missing id token');
        idToken=tokens.id_token;
      } catch {throw new HttpError(503,'登入服務暫時無法使用');}
      const identity=await verifyGoogleIdentity(idToken,env,flow.nonce);
      if(admin && !adminIdentityAllowed(identity,env))throw new HttpError(403,'沒有管理權限');
      res=await setSession(req,env,identity,redirect());
    }
  } catch(error) {res=redirect(error instanceof HttpError && error.status===503?'unavailable':'failed');}
  res.headers.append('Set-Cookie',cookie(req,env,'oauth','',0));return res;
}
export async function logoutMerchant(req: Request, env: Env) {
  const token=readCookie(req,cookieName(req,env,'session'));
  if(token)await env.DB.prepare('DELETE FROM merchant_sessions WHERE token_hash=?').bind(await hashToken(token)).run();
  const res=response({message:'已登出本站。'});res.headers.append('Set-Cookie',cookie(req,env,'session','',0));
  const browser=readCookie(req,cookieName(req,env,'oauth'));
  if(browser)await env.DB.prepare('DELETE FROM oauth_states WHERE browser_hash=?').bind(await hashToken(browser)).run();
  res.headers.append('Set-Cookie',cookie(req,env,'oauth','',0));return res;
}
export async function limitMerchantSubmissions(env: Env, identity: MerchantIdentity) {
  const key='merchant:'+await hashToken(identity.google_sub);
  const result=await env.DB.prepare('INSERT INTO daily_intake(day,kind,count) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 WHERE count<3 RETURNING count')
    .bind(new Date().toISOString().slice(0,10),key).first();
  if(!result)throw new HttpError(429,'每個 Google 帳號每日最多登記 3 個場地，更多場地請聯絡主辦單位。');
}

export function adminIdentityAllowed(identity: MerchantIdentity, env: Env) {
  return identity.identity_provider==='google' && identity.email_authoritative===1 &&
    (env.ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean).includes(identity.email.toLowerCase());
}
export async function requireAdmin(req: Request, env: Env) {
  if(localDevelopment(req,env))return 'local-admin@example.com';
  if(!env.ADMIN_EMAILS)throw new HttpError(503,'管理者登入尚未設定。');
  const identity=await merchantSession(req,env,true);
  if(!identity)throw new HttpError(401,'請先使用 Google 帳號登入管理後台。');
  if(!adminIdentityAllowed(identity,env))throw new HttpError(403,'此 Google 帳號沒有管理權限。');
  return identity.email;
}
