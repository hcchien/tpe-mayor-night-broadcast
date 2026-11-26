import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url),'utf8'));
const v=config.vars;const problems=[];
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
if (!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id.startsWith('00000000')) problems.push('設定 D1 database_id');
if (!v.SITE_ORIGIN?.startsWith('https://') || v.SITE_ORIGIN.includes('replace-me')) problems.push('設定 HTTPS 正式 SITE_ORIGIN');
if (!config.routes?.some(r=>r.custom_domain&&`https://${r.pattern}`===v.SITE_ORIGIN)) problems.push('新增與 SITE_ORIGIN 相同的 Workers custom_domain route');
if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(v.ACCESS_TEAM_DOMAIN) || v.ACCESS_TEAM_DOMAIN.includes('replace-me') || !v.ACCESS_AUD || v.ACCESS_AUD==='replace-me') problems.push('設定 Access team domain 與 Application AUD');
if (!v.TURNSTILE_SITE_KEY || /^[123]x000/.test(v.TURNSTILE_SITE_KEY)) problems.push('設定正式 Turnstile site key');
if (!v.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com')) problems.push('設定 Google OAuth Web Client ID');
if (v.ENVIRONMENT!=='production' || v.LOCAL_DEV_AUTH) problems.push('正式環境不得啟用本機驗證');
if (!v.CONTACT_EMAIL || !v.ORGANIZER_NAME || !dateValid(v.PRIVACY_DELETE_AFTER) || v.PRIVACY_DELETE_AFTER < new Date().toISOString().slice(0,10)) problems.push('設定主辦名稱、聯絡 Email 與未來的資料刪除日期');
if (config.workers_dev !== false || config.preview_urls !== false) problems.push('停用 workers.dev 及 preview URLs');
if (problems.length){console.error('部署前請完成：\n'+problems.map(p=>'• '+p).join('\n'));process.exit(1);}
console.log('靜態部署檢查通過。仍須確認已設定 ADMIN_EMAILS、TURNSTILE_SECRET_KEY、IP_HASH_SECRET、GOOGLE_CLIENT_SECRET，以及 Access policy 與 Google callback URL。');
