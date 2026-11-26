import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { environment, submission } from './support';
import { localDevelopment, readJson, requireAdmin, requireOrigin, verifyAdminToken, verifyTurnstile, rateLimit } from '../src/security';
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
test('Access JWT validates signature, audience, issuer, expiry and allowlist',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';const keys=createLocalJWKSet({keys:[jwk]});
  const env=environment();
  const token=async(payload={}, issuer='https://team.cloudflareaccess.com',aud='test-aud',expiry='5m')=>new SignJWT({email:'admin@example.com',...payload}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('admin').setIssuedAt().setIssuer(issuer).setAudience(aud).setExpirationTime(expiry).sign(privateKey);
  assert.equal(await verifyAdminToken(await token(),env,keys),'admin@example.com');
  for(const invalid of [await token({email:'other@example.com'}),await token({},'https://evil.example'),await token({},undefined,'other-aud'),await token({},undefined,undefined,'-1s'),'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIn0.'])await assert.rejects(()=>verifyAdminToken(invalid,env,keys),/權限/);
  const other=await generateKeyPair('RS256');const forged=await new SignJWT({email:'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('admin').setIssuer('https://team.cloudflareaccess.com').setAudience('test-aud').setIssuedAt().setExpirationTime('5m').sign(other.privateKey);await assert.rejects(()=>verifyAdminToken(forged,env,keys));
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
