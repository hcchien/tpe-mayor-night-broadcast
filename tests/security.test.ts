import { requireAdmin } from '../src/merchant-auth';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, submission, testSession } from './support';
import { localDevelopment, readJson, requireOrigin, verifyTurnstile, rateLimit } from '../src/security';
import { submissionSchema } from '../src/schema';
import { validDate } from '../src/config';

test('retention date rejects impossible calendar dates',()=>{
  assert.equal(validDate('2028-02-29'),true);
  for(const value of ['2027-02-29','2026-02-31','2026-13-01','invalid',undefined])assert.equal(validDate(value),false);
});

test('registration rejects injected admin fields, unsafe links, missing consent and honeypot',()=>{
  for (const change of [{status:'approved'},{booking_url:'javascript:alert(1)'},{booking_url:'https://user:pass@example.com'},{consent:false},{website:'spam'},{capacity:5001},{contact_email:'not-email'},{district:'其他'}]) assert.equal(submissionSchema.safeParse({...submission,...change}).success,false);
});
test('local authentication bypass requires development flag AND loopback HTTP',()=>{
  assert.equal(localDevelopment(new Request('http://127.0.0.1:8787/admin/'),environment()),true);
  for(const url of ['https://127.0.0.1/admin/','http://evil.example/admin/','https://example.com/admin/'])assert.equal(localDevelopment(new Request(url),environment()),false);
  assert.equal(localDevelopment(new Request('http://127.0.0.1/admin/'),environment({ENVIRONMENT:'production'})),false);
});
test('admin rejects forged email headers and missing JWT',async()=>{
  await assert.rejects(()=>requireAdmin(new Request('https://example.com/admin/',{headers:{'Cf-Access-Authenticated-User-Email':'admin@example.com'}}),environment({ENVIRONMENT:'production'})),/登入/);
});
test('admin requires an authoritative Google session, rechecks allowlist and rejects expired or forged sessions',async()=>{
  const env=environment({ENVIRONMENT:'production',SITE_ORIGIN:'https://example.com'});
  const request=(cookie:string)=>new Request(env.SITE_ORIGIN+'/admin/',{headers:{Cookie:cookie}});
  const allowed=testSession(env,'admin@example.com');
  assert.equal(await requireAdmin(request(allowed),env),'admin@example.com');
  await assert.rejects(()=>requireAdmin(request(testSession(env,'other@example.com')),env),/權限/);
  env.ADMIN_EMAILS='changed@example.com';await assert.rejects(()=>requireAdmin(request(allowed),env),/權限/);env.ADMIN_EMAILS='admin@example.com';
  for(const changes of ["email_authoritative=0","identity_provider='local'","expires_at=1"]){
    (env.DB as any).sql.exec('UPDATE merchant_sessions SET '+changes);
    await assert.rejects(()=>requireAdmin(request(allowed),env));
    (env.DB as any).sql.exec("UPDATE merchant_sessions SET email_authoritative=1,identity_provider='google',expires_at=9999999999");
  }
  await assert.rejects(()=>requireAdmin(request('__Host-night-session='+'x'.repeat(43)),env));
  await assert.rejects(()=>requireAdmin(request(allowed+'; '+allowed),env));
});
test('CSRF rejects missing / foreign Origin and non-JSON bodies',()=>{
  const env=environment();
  for(const headers of [{},{Origin:'https://evil.example','Content-Type':'application/json'},{Origin:env.SITE_ORIGIN,'Content-Type':'text/plain'}])assert.throws(()=>requireOrigin(new Request(env.SITE_ORIGIN+'/api/venues',{method:'POST',headers}),env));
});
test('streamed request limit works without Content-Length',async()=>{
  await assert.rejects(()=>readJson(new Request('https://example.com',{method:'POST',body:'x'.repeat(17000)})),/大小/);
  await assert.rejects(()=>readJson(new Request('https://example.com',{method:'POST',body:'{broken'})),/格式/);
});
test('Turnstile checks hostname and action, rejects test keys in production and fails closed',async()=>{
  const original=globalThis.fetch;const env=environment({ENVIRONMENT:'production',SITE_ORIGIN:'https://example.com'});const req=new Request(env.SITE_ORIGIN);
  try{
    for(const result of [{success:false},{success:true,hostname:'evil.example',action:'register'},{success:true,hostname:'example.com',action:'report'}]){globalThis.fetch=async()=>Response.json(result);await assert.rejects(()=>verifyTurnstile(req,env,'token','register'));}
    globalThis.fetch=async()=>Response.json({success:true,hostname:'example.com',action:'register'});await verifyTurnstile(req,env,'token','register');
    await assert.rejects(()=>verifyTurnstile(req,{...env,TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'},'token','register'));
    globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(()=>verifyTurnstile(req,env,'token','register'),/暫時/);
  }finally{globalThis.fetch=original;}
});
test('rate limiter receives a hash rather than raw IP, and rejects missing protection',async()=>{
  let observed='';const env=environment({ENVIRONMENT:'production',WRITE_LIMITER:{limit:async({key}:{key:string})=>{observed=key;return {success:false};}} as RateLimit});
  const req=new Request('https://example.com',{headers:{'CF-Connecting-IP':'192.0.2.123'}});
  await assert.rejects(()=>rateLimit(req,env,true),/頻繁/);assert.match(observed,/^[a-f0-9]{64}$/);assert.ok(!observed.includes('192.0.2.123'));
  await assert.rejects(()=>rateLimit(req,{...env,IP_HASH_SECRET:''},true),/尚未/);
});
