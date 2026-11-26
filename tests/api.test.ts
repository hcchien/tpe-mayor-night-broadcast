import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import { environment, submission, venue, ctx, testSession } from './support';

function client(env=environment()) {
  const session=testSession(env);
  const request=(path:string,method='GET',body?:unknown,headers={})=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers:{Origin:env.SITE_ORIGIN,'Content-Type':'application/json',Cookie:session,...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,ctx);
  return {env,request};
}
test('registration → private pending → approve → public projection → report → withdraw → delete',async()=>{
  const {env,request}=client();const created=await request('/api/venues','POST',submission);assert.equal(created.status,201);const {id}=await created.json() as any;
  assert.equal((await (await request('/api/venues')).json() as any).total,0);
  let admin=await (await request('/api/admin/venues')).json() as any;assert.equal(admin.venues[0].contact_email,venue.contact_email);
  assert.equal((await request(`/api/admin/venues/${id}`,'PATCH',{version:1,status:'approved',moderation_note:'已電話確認授權與設備'})).status,200);
  let publicData=await (await request('/api/venues')).json() as any;assert.equal(publicData.total,1);assert.equal(publicData.venues[0].name,venue.name);
  for(const key of ['contact_name','contact_email','contact_phone','moderation_note','consent_version','version','owner_google_sub','owner_google_email','owner_email_authoritative','owner_verified_at','owner_identity_provider'])assert.equal(key in publicData.venues[0],false);
  assert.equal((await request('/api/reports','POST',{venue_id:id,reason:'店家的當天開放時間可能不正確。',website:'',turnstile_token:'local-development'})).status,201);
  const reports=await (await request('/api/admin/reports')).json() as any;assert.equal(reports.reports.length,1);
  assert.equal((await request(`/api/admin/reports/${reports.reports[0].id}`,'PATCH',{resolution:'已聯絡店家確認並修正'})).status,200);
  assert.equal((await request(`/api/admin/venues/${id}`,'PATCH',{version:2,status:'withdrawn',moderation_note:'店家要求取消參加'})).status,200);
  publicData=await (await request('/api/venues')).json() as any;assert.equal(publicData.total,0);
  assert.equal((await request(`/api/admin/venues/${id}`,'DELETE',{version:3})).status,200);
  const logs=await (await request('/api/admin/audit')).json() as any;assert.equal(logs.logs.length,4);
  assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM reports').get().n,0);
});
test('concurrent moderation uses optimistic version and does not create false audit entries',async()=>{
  const {env,request}=client();const {id}=await (await request('/api/venues','POST',submission)).json() as any;
  const action={version:1,status:'approved',moderation_note:'已確認授權'};
  assert.equal((await request(`/api/admin/venues/${id}`,'PATCH',action)).status,200);
  assert.equal((await request(`/api/admin/venues/${id}`,'PATCH',action)).status,409);
  assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM audit_log').get().n,1);
});
test('admin edit preserves pending state unless explicitly approved; untrusted fields rejected',async()=>{
  const {request}=client();const {id}=await (await request('/api/venues','POST',submission)).json() as any;
  const response=await request(`/api/admin/venues/${id}`,'PATCH',{version:1,status:'pending',moderation_note:'等待再次查核',venue:{...venue,name:'已更正店名'}});assert.equal(response.status,200);
  assert.equal((await (await request('/api/venues')).json() as any).total,0);
  assert.equal((await request('/api/venues','POST',{...submission,status:'approved'})).status,400);
});
test('daily cap is enforced across requests and intake never inserts extra venues',async()=>{
  const {env,request}=client(environment({DAILY_SUBMISSION_LIMIT:'2'}));
  assert.equal((await request('/api/venues','POST',submission)).status,201);
  assert.equal((await request('/api/venues','POST',submission)).status,201);
  assert.equal((await request('/api/venues','POST',submission)).status,429);
  assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM venues').get().n,2);
});
test('filters escape SQL wildcards, reject invalid pagination and never leak pending contacts',async()=>{
  const {request}=client();const {id}=await (await request('/api/venues','POST',submission)).json() as any;
  await request(`/api/admin/venues/${id}`,'PATCH',{version:1,status:'approved',moderation_note:'確認正確'});
  for(const q of ['%',"' OR 1=1 --",'_'])assert.equal((await (await request('/api/venues?q='+encodeURIComponent(q))).json() as any).total,0);
  assert.equal((await (await request('/api/venues?district='+encodeURIComponent('中正區')+'&accessible=1')).json() as any).total,1);
  for(const query of ['page=-1','page=1.5','page=1001','district=unknown'])assert.equal((await request('/api/venues?'+query)).status,400);
});
test('production admin page and APIs fail closed, and alternate hosts are rejected',async()=>{
  const env=environment({ENVIRONMENT:'production',SITE_ORIGIN:'https://example.com'});const {request}=client(env);
  for(const path of ['/admin','/admin/','/admin/index.html','/api/admin/venues','/api/admin/reports','/api/admin/audit'])assert.equal((await request(path)).status,401);
  assert.equal((await worker.fetch(new Request('https://alternate.example/api/config'),env,ctx)).status,403);
});
test('closed or expired registrations reject writes and cron removes personal data',async()=>{
  const {env,request}=client();await request('/api/venues','POST',submission);
  env.REGISTRATION_OPEN='false';assert.equal((await request('/api/venues','POST',submission)).status,403);
  env.REGISTRATION_OPEN='true';env.PRIVACY_DELETE_AFTER='2000-01-01';assert.equal((await request('/api/venues','POST',submission)).status,403);
  await worker.scheduled({} as ScheduledController,env);
  assert.equal((env.DB as any).sql.prepare('SELECT COUNT(*) n FROM venues').get().n,0);
});
test('API failures are no-store and security headers prevent framing and sniffing',async()=>{
  const {request}=client();const r=await request('/api/venues','POST',{...submission,contact_phone:'bad'});assert.equal(r.status,400);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-security-policy')!,/object-src 'none'/);
});
