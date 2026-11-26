import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../src/index';
import { beginGoogleLogin, consumeOAuthState, hashToken, merchantSession, verifyGoogleIdentity } from '../src/merchant-auth';
import { environment, ctx, submission, testSession } from './support';
import type { Env } from '../src/types';

const production=()=>environment({ENVIRONMENT:'production',SITE_ORIGIN:'https://night.example.com',GOOGLE_CLIENT_ID:'test-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only-client-secret'});
function request(env:Env,path:string,method='GET',body?:unknown,cookie='',headers:Record<string,string>={}) {
  return worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers:{Origin:env.SITE_ORIGIN,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.10',Cookie:cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
}
const cookiePair=(res:Response,name:string)=>res.headers.getSetCookie().find(c=>c.startsWith(name+'='))!.split(';')[0];

test('anonymous registration is rejected; Google email and subject cannot be supplied by the form',async()=>{
  const env=environment();
  assert.equal((await request(env,'/api/venues','POST',submission)).status,401);
  const session=testSession(env);
  assert.equal((await request(env,'/api/venues','POST',{...submission,contact_email:'victim@example.com'},session)).status,403);
  assert.equal((await request(env,'/api/venues','POST',{...submission,owner_google_sub:'victim'},session)).status,400);
  const result=await request(env,'/api/venues','POST',submission,session);assert.equal(result.status,201);
  const row=(env.DB as any).sql.prepare('SELECT * FROM venues').get();assert.equal(row.owner_google_sub,'test-google-sub');assert.equal(row.owner_google_email,submission.contact_email);assert.equal(row.status,'pending');
});

test('account quota follows Google subject across sessions and IPs',async()=>{
  const env=environment();const a=testSession(env);const b=testSession(env,'private@example.com');
  for(let i=0;i<3;i++)assert.equal((await request(env,'/api/venues','POST',submission,a)).status,201);
  assert.equal((await request(env,'/api/venues','POST',submission,b,{'CF-Connecting-IP':'192.0.2.20'})).status,429);
  const c=testSession(env,'private@example.com','different-google-sub');assert.equal((await request(env,'/api/venues','POST',submission,c)).status,201);
});

test('Google ID token checks RSA signature, issuer, audience, expiry, nonce, azp and verified email',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='google-unit';const keys=createLocalJWKSet({keys:[jwk]});const env=production();
  const sign=(payload:Record<string,unknown>={})=>new SignJWT({sub:'google-sub',email:'merchant@gmail.com',email_verified:true,nonce:'expected-nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,...payload}).setProtectedHeader({alg:'RS256',kid:'google-unit'}).sign(privateKey);
  const identity=await verifyGoogleIdentity(await sign(),env,'expected-nonce',keys);assert.equal(identity.google_sub,'google-sub');assert.equal(identity.email_authoritative,1);
  for(const payload of [{iss:'https://attacker.example'},{aud:'other-client'},{exp:1},{nonce:'wrong'},{email_verified:false},{email_verified:'true'},{email:'invalid'},{azp:'other-client'},{sub:''},{iat:Math.floor(Date.now()/1000)+300},{aud:[env.GOOGLE_CLIENT_ID,'another-client']}])await assert.rejects(()=>sign(payload).then(token=>verifyGoogleIdentity(token,env,'expected-nonce',keys)),/驗證失敗/);
  const outsider=await generateKeyPair('RS256');const forged=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'google-unit'}).sign(outsider.privateKey);await assert.rejects(()=>verifyGoogleIdentity(forged,env,'expected-nonce',keys));
  const external=await verifyGoogleIdentity(await sign({email:'merchant@third-party.example'}),env,'expected-nonce',keys);assert.equal(external.email_authoritative,0);
  const workspace=await verifyGoogleIdentity(await sign({email:'merchant@company.example',hd:'company.example'}),env,'expected-nonce',keys);assert.equal(workspace.email_authoritative,1);
});

test('Google redirect uses PKCE and minimum scopes; browser binding, expiry and one-time state are enforced',async()=>{
  const env=production();const req=new Request(env.SITE_ORIGIN+'/api/auth/login',{method:'POST'});
  const start=await beginGoogleLogin(req,env);const {url}=await start.json() as any;const authUrl=new URL(url);const state=authUrl.searchParams.get('state')!;const browser=cookiePair(start,'__Host-night-oauth');
  assert.equal(authUrl.origin,'https://accounts.google.com');assert.equal(authUrl.searchParams.get('scope'),'openid email');assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');assert.equal(authUrl.searchParams.get('redirect_uri'),env.SITE_ORIGIN+'/api/auth/callback');assert.equal(authUrl.searchParams.has('access_type'),false);
  assert.match(start.headers.get('Set-Cookie')!,/HttpOnly; SameSite=Lax/);assert.match(start.headers.get('Set-Cookie')!,/; Secure/);assert.match(start.headers.get('Set-Cookie')!,/Path=\//);
  const callback=(cookie='')=>new Request(env.SITE_ORIGIN+'/api/auth/callback?state='+state,{headers:{Cookie:cookie}});
  await assert.rejects(()=>consumeOAuthState(callback(),env));await assert.rejects(()=>consumeOAuthState(callback('__Host-night-oauth='+'x'.repeat(43)),env));
  const flow=await consumeOAuthState(callback(browser),env);assert.equal(flow.nonce,authUrl.searchParams.get('nonce'));
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(flow.code_verifier))).toString('base64url');assert.equal(challenge,authUrl.searchParams.get('code_challenge'));
  await assert.rejects(()=>consumeOAuthState(callback(browser),env));
  const expired=await beginGoogleLogin(req,env);const expiredURL=new URL((await expired.json() as any).url);(env.DB as any).sql.exec('UPDATE oauth_states SET expires_at=1');
  await assert.rejects(()=>consumeOAuthState(new Request(env.SITE_ORIGIN+'/api/auth/callback?state='+expiredURL.searchParams.get('state'),{headers:{Cookie:cookiePair(expired,'__Host-night-oauth')}}),env));
});

test('complete Google code exchange issues an opaque session, prevents replay and logout revokes it',async()=>{
  const env=production();const originalFetch=globalThis.fetch;const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='integration-key';let exchanges=0;let turnstileSuccess=false;
  try{
    const start=await request(env,'/api/auth/login','POST',{});assert.equal(start.status,200);const authURL=new URL((await start.json() as any).url);const state=authURL.searchParams.get('state');const nonce=authURL.searchParams.get('nonce');const browser=cookiePair(start,'__Host-night-oauth');
    const idToken=await new SignJWT({email:'merchant@gmail.com',email_verified:true,nonce}).setSubject('google-merchant-123').setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').setProtectedHeader({alg:'RS256',kid:'integration-key'}).sign(privateKey);
    globalThis.fetch=async(input:any,init:any)=>{
      const url=typeof input==='string'?input:input.url||String(input);
      if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
      if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:turnstileSuccess,hostname:'night.example.com',action:'register'});
      assert.equal(url,'https://oauth2.googleapis.com/token');exchanges++;
      const body=new URLSearchParams(init.body);assert.equal(body.get('client_secret'),env.GOOGLE_CLIENT_SECRET);assert.equal(body.get('code'),'test-code');assert.equal(body.get('redirect_uri'),env.SITE_ORIGIN+'/api/auth/callback');assert.ok(body.get('code_verifier'));
      return Response.json({id_token:idToken,access_token:'discard-me'});
    };
    const callback=await request(env,'/api/auth/callback?state='+state+'&code=test-code','GET',undefined,browser);assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),env.SITE_ORIGIN+'/#register');
    const session=cookiePair(callback,'__Host-night-session');assert.match(callback.headers.getSetCookie().find(c=>c.startsWith('__Host-night-session='))!,/Max-Age=43200; Secure/);
    const raw=session.split('=')[1];const row=(env.DB as any).sql.prepare('SELECT * FROM merchant_sessions').get();assert.notEqual(row.token_hash,raw);assert.equal(row.token_hash,await hashToken(raw));assert.equal(row.google_sub,'google-merchant-123');assert.ok(!JSON.stringify(row).includes('discard-me'));
    const me=await request(env,'/api/auth/me','GET',undefined,session);assert.equal(me.headers.get('Cache-Control'),'no-store');assert.equal((await me.json() as any).user.email,'merchant@gmail.com');
    assert.equal((await request(env,'/api/venues','POST',{...submission,contact_email:'merchant@gmail.com'},session)).status,400); // real Turnstile is still required; no auth bypass
    turnstileSuccess=true;
    assert.equal((await request(env,'/api/venues','POST',{...submission,contact_email:'merchant@gmail.com'},session)).status,201);
    assert.equal((env.DB as any).sql.prepare('SELECT owner_google_sub FROM venues').get().owner_google_sub,'google-merchant-123');
    assert.equal((await request(env,'/api/admin/venues','GET',undefined,session)).status,403);
    const replay=await request(env,'/api/auth/callback?state='+state+'&code=test-code','GET',undefined,browser);assert.match(replay.headers.get('Location')!,/login_error=failed/);assert.equal(exchanges,1);
    assert.equal((await request(env,'/api/auth/logout','POST',{},session,{Origin:'https://evil.example'})).status,403);
    const logout=await request(env,'/api/auth/logout','POST',{},session);assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie')!,/Max-Age=0/);
    assert.equal((await (await request(env,'/api/auth/me','GET',undefined,session)).json() as any).user,null);
  }finally{globalThis.fetch=originalFetch;}
});

test('forged, duplicated, expired, revoked and development-only sessions are denied',async()=>{
  const env=production();const session=testSession(env);const check=(cookie:string)=>merchantSession(new Request(env.SITE_ORIGIN,{headers:{Cookie:cookie}}),env);
  assert.equal(await check('__Host-night-session='+'x'.repeat(43)),null);assert.equal(await check(session+'; '+session),null);assert.ok(await check(session));
  (env.DB as any).sql.exec("UPDATE merchant_sessions SET identity_provider='local'");assert.equal(await check(session),null);
  (env.DB as any).sql.exec("UPDATE merchant_sessions SET identity_provider='google',expires_at=1");assert.equal(await check(session),null);
  (env.DB as any).sql.exec('DELETE FROM merchant_sessions');assert.equal(await check(session),null);
});

test('login initiation requires same-origin POST; missing config fails closed; callback errors redirect safely',async()=>{
  const env=production();assert.equal((await request(env,'/api/auth/login')).status,404);
  assert.equal((await request(env,'/api/auth/login','POST',{},'',{Origin:'https://evil.example'})).status,403);
  assert.equal((await request({...env,GOOGLE_CLIENT_SECRET:''},'/api/auth/login','POST',{})).status,503);
  const bad=await request(env,'/api/auth/callback?code=secret-code&state=bad');assert.equal(bad.status,303);assert.equal(bad.headers.get('Location'),env.SITE_ORIGIN+'/?login_error=failed#register');assert.equal(bad.headers.get('Cache-Control'),'no-store');
});

test('cancelled login and token exchange failures consume state without creating sessions',async()=>{
  const env=production();const originalFetch=globalThis.fetch;
  try {
    for(const cancelled of [true,false]){
      const start=await request(env,'/api/auth/login','POST',{});const url=new URL((await start.json() as any).url);const browser=cookiePair(start,'__Host-night-oauth');
      globalThis.fetch=async()=>{throw new Error('network failure');};
      const callback=await request(env,'/api/auth/callback?state='+url.searchParams.get('state')+(cancelled?'&error=access_denied':'&code=unavailable-code'),'GET',undefined,browser);
      assert.equal(callback.headers.get('Location'),env.SITE_ORIGIN+'/?login_error='+(cancelled?'cancelled':'unavailable')+'#register');
      assert.match(callback.headers.get('Set-Cookie')!,/Max-Age=0/);
      assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM merchant_sessions').get().n,0);
      assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM oauth_states').get().n,0);
    }
  } finally { globalThis.fetch=originalFetch; }
});

test('local login still uses a revocable session and expiry cleanup removes state and identity',async()=>{
  const env=environment();const start=await request(env,'/api/auth/login','POST',{});const session=cookiePair(start,'night-session');
  assert.equal((await (await request(env,'/api/auth/me','GET',undefined,session)).json() as any).user.provider,'local');
  const again=await request(env,'/api/auth/login','POST',{},session);assert.notEqual(cookiePair(again,'night-session'),session);assert.equal((await (await request(env,'/api/auth/me','GET',undefined,session)).json() as any).user,null);
  env.PRIVACY_DELETE_AFTER='2000-01-01';await worker.scheduled({} as ScheduledController,env);
  assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM merchant_sessions').get().n,0);
});

test('admin login stays available when merchant registration is closed and stores its purpose server-side',async()=>{
  const env=production();env.REGISTRATION_OPEN='false';
  assert.equal((await request(env,'/api/auth/login','POST',{})).status,403);
  const start=await request(env,'/api/auth/login','POST',{admin:true});assert.equal(start.status,200);
  const authUrl=new URL((await start.json() as any).url);
  const flow=await consumeOAuthState(new Request(env.SITE_ORIGIN+'/api/auth/callback?state='+authUrl.searchParams.get('state'),{headers:{Cookie:cookiePair(start,'__Host-night-oauth')}}),env);
  assert.equal(flow.admin_login,1);
});
