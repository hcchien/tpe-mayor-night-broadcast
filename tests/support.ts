import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Env } from '../src/types';
// Run the real migration and SQL against SQLite; preserve D1 batch transaction semantics.
export function database() {
  const sql = new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  class Statement {
    params: any[]=[];
    constructor(public query: string) {}
    bind(...params:any[]){const copy=new Statement(this.query);copy.params=params;return copy;}
    async first(){return sql.prepare(this.query).get(...this.params)||null;}
    async all(){return {results:sql.prepare(this.query).all(...this.params),success:true,meta:{}};}
    async run(){const r=sql.prepare(this.query).run(...this.params);return {results:[],success:true,meta:{changes:Number(r.changes)}};}
  }
  return {sql,prepare:(q:string)=>new Statement(q),async batch(statements:Statement[]){sql.exec('BEGIN');try{const result=[];for(const s of statements){result.push(/^\s*SELECT/i.test(s.query)?await s.all():await s.run());}sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
export function environment(overrides:Partial<Env>={}): Env {
  return {DB:database(),ASSETS:{fetch:async()=>new Response('static')},WRITE_LIMITER:{limit:async()=>({success:true})},READ_LIMITER:{limit:async()=>({success:true})},ENVIRONMENT:'development',LOCAL_DEV_AUTH:'true',SITE_ORIGIN:'http://127.0.0.1:8787',ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com',ACCESS_AUD:'test-aud',ADMIN_EMAILS:'admin@example.com',TURNSTILE_SITE_KEY:'test-site-key',TURNSTILE_SECRET_KEY:'real-shaped-test-secret',IP_HASH_SECRET:'0123456789012345678901234567890123456789',REGISTRATION_OPEN:'true',DAILY_SUBMISSION_LIMIT:'200',EVENT_LABEL:'測試活動',EVENT_TIME:'時間待公布',LIVESTREAM_URL:'',CONTACT_EMAIL:'organizer@example.com',ORGANIZER_NAME:'測試主辦',PRIVACY_DELETE_AFTER:'2099-12-31',...overrides} as unknown as Env;
}
export const venue = {name:'測試咖啡店',district:'中正區',category:'咖啡廳',address:'台北市中正區測試路 100 號',capacity:40,screen:'75 吋電視',opening_time:'18:00–22:00',cost:'低消一杯飲料',description:'這是一間供測試使用的店家，歡迎一起看直播。',booking_url:'https://example.com/booking',accessible:true,contact_name:'私人聯絡人',contact_email:'private@example.com',contact_phone:'02-2345-6789'};
export const submission = {...venue,consent:true,website:'',turnstile_token:'local-development'};
export const ctx = {waitUntil:()=>{},passThroughOnException:()=>{}} as unknown as ExecutionContext;
export function testSession(env:Env,email=venue.contact_email,sub='test-google-sub') {
  const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  (env.DB as any).sql.prepare('INSERT INTO merchant_sessions(token_hash,google_sub,email,email_authoritative,identity_provider,authenticated_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run(createHash('sha256').update(token).digest('hex'),sub,email,1,'google',new Date().toISOString(),Math.floor(Date.now()/1000)+3600);
  return `${env.ENVIRONMENT==='production'?'__Host-':''}night-session=${token}`;
}
