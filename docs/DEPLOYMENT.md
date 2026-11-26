# Cloudflare 部署與維運

## 1. 準備帳號與網域

使用 Cloudflare Workers Free、D1、Turnstile，以及 Cloudflare Zero Trust / Access 的免費方案起步。管理員人數請維持在帳號方案額度內；任何付費方案變更均需自行評估。正式站採 **Cloudflare 管理的自訂網域**，停用 workers.dev 與 preview URLs，避免後台繞過 Access 的另一入口。

登入後建立 DB：

```bash
npm ci
npx wrangler login
npx wrangler d1 create tpe-mayor-night-broadcast
```

將建立結果的 UUID 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。新增：

```json
"routes": [{ "pattern": "night.your-domain.tw", "custom_domain": true }]
```

若已存在同名 DNS 記錄，先確認現有服務用途，再依 Cloudflare 指示處理衝突；不要直接覆蓋其他服務。

## 2. 公開設定

編輯 `wrangler.jsonc` 的 `vars`。此檔公開於 repo，**不要放秘密**。

| 變數 | 設定 |
| --- | --- |
| `SITE_ORIGIN` | `https://night.your-domain.tw`，不含結尾斜線，須與 route 相符 |
| `ENVIRONMENT` | 固定 `production` |
| `EVENT_LABEL` | 活動名稱（供 API；首頁目前採台北市長選前之夜固定文案） |
| `EVENT_TIME` | 顯示日期、時間與時區，例如由主辦確認的台北時間；勿用未確認資訊 |
| `LIVESTREAM_URL` | 官方直播 HTTPS 網址，尚未確定留空 |
| `ORGANIZER_NAME` | 實際主辦／個資管理者名稱 |
| `CONTACT_EMAIL` | 可收信且確實有人處理的主辦信箱，用於修改、撤回與刪除要求 |
| `PRIVACY_DELETE_AFTER` | `YYYY-MM-DD` UTC 日期，該日結束後排程刪除；先決定活動後必要保存期間 |
| `REGISTRATION_OPEN` | 初次 `false`；實站驗證完成才改 `true` |
| `DAILY_SUBMISSION_LIMIT` | 預設 `200`，最多 `1000`；店家登記與問題回報分別各自計數 |
| `TURNSTILE_SITE_KEY` | 正式 widget 的公開 site key |
| `GOOGLE_CLIENT_ID` | Google OAuth「Web application」類型的 Client ID，結尾為 `.apps.googleusercontent.com` |
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com`，不含 `https://` |
| `ACCESS_AUD` | Access Application Audience (AUD) Tag |

`ADMIN_EMAILS` 以 secret 儲存（第 4 節），不放入公開 repo。

`ratelimits` 的 namespace ID 在同一帳號應為本網站獨有；若 `1001` / `1002` 已被其他 Worker 使用，換成未使用的正整數字串。

## 3. 建立 Cloudflare Access

1. Zero Trust → Access → Applications → Add application → Self-hosted。
2. 建立**同一個 Application**，在 Public hostname 設定中加入正式 hostname 的兩個受保護路徑：`/admin` 與 `/api/admin`（Access 路徑設定涵蓋各自的子路徑；若介面要求 wildcard，設定 `/admin/*`、`/api/admin/*`，並確保裸路徑也受到保護）。兩者必須共用同一個 AUD，否則前台後台 AJAX 會驗證失敗。
3. Allow policy 限定明確的管理者 Email；使用 Google 等 IdP 或 Email one-time PIN。不要用 `Everyone`、`Bypass` 或 public allow policy。管理者啟用 MFA；可在 policy 加入所需身分驗證強度。
4. Session duration 建議 1 小時；複製 AUD 與 team domain 到設定。
5. 登入可先由 `/admin/` 觸發；Worker 會再次使用遠端 JWKS 驗證 RS256 簽章、issuer、audience、有效期與 Email allowlist，**不單憑 email header 或 cookie 值放行**。
6. 使用 `wrangler secret put ADMIN_EMAILS` 更新管理員名單，移除者下次請求即因 allowlist 不符被拒絕。必要時同時撤銷 Access session。

不要將全站都放進這個 Access application，公開民眾仍應可直接瀏覽首頁與登記。

## 3a. 店家 Google OAuth（與後台 Access 分開）

1. 在 Google Cloud 專案的 Google Auth Platform 建立此網站專用的 OAuth client，類型為 **Web application**。不共用 CMS 或其他專案的 client secret。
2. Audience 設為 External，設定真實的 app name、支援信箱、首頁 `https://night.your-domain.tw/`、隱私政策 `https://night.your-domain.tw/privacy.html` 與已驗證的 authorized domain。
3. Authorized redirect URI 必須完全一致：`https://night.your-domain.tw/api/auth/callback`。本實作是後端 authorization code flow，不靠 JavaScript SDK，也不需將 Google script 加入 CSP。
4. 僅使用 `openid email`，不要求 profile、Gmail、Drive 或 offline access。依 Google 控制台顯示完成必要的 branding／verification 要求；Testing 狀態時只允許設定的 test users，對外招募前須確認一般外部帳號可登入。不要因為 scopes 少就假定不會有品牌審核或警告。
5. Client ID 填入 `GOOGLE_CLIENT_ID`；client secret 用 `wrangler secret put GOOGLE_CLIENT_SECRET` 安裝，不提交至 Git。
6. `/api/auth/*` 必須保持可由公開訪客連線，不能放入管理者 Access 限制；它有獨立的伺服器驗證。Google 店家登入不授予 `/api/admin/*` 權限。
7. 套用 migration `0002_merchant_google_auth.sql`。舊店家資料保留，但 owner 欄位為空，後台標記「未完成 Google 驗證」，不會把原先自填的 Email 當成已驗證身分。

實際流程：同源 POST 啟動登入 → Google 同意頁 → server-side code exchange → 檢查簽章、issuer、audience、expiry、nonce、email_verified → 發出本站 12 小時 Session。OAuth state 有效 10 分鐘且只能使用一次，綁定原瀏覽器 Cookie，使用 PKCE S256。正式 Session Cookie 使用 `__Host-`、Secure、HttpOnly、SameSite=Lax；DB 只保存 Session token 的 SHA-256，不存 Google access/refresh token。

測試環境可用本機 mock 完成 UI 測試；**真正 Google redirect、同意頁、cookies 與 client 設定必須另在正式／獨立 staging 網域驗證**。若需撤銷店家登入，可在 D1 管理介面以 Google subject 刪除其 `merchant_sessions`；此版本沒有長期帳號封鎖名單。Google 端取消授權不會即時撤銷既有本站 Session；本站登出會立即撤銷，否則最多保留 12 小時。

## 4. Turnstile 與 secrets

在 Turnstile 建立 Managed widget，hostname 只加入正式網域。正式 widget 不允許 localhost，不使用測試 key。將 site key 寫入 vars；secret key 用互動指令輸入，避免進入 shell history：

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put IP_HASH_SECRET
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

`IP_HASH_SECRET` 使用密碼管理器產生至少 32 字元隨機值。部署程式會以這個值 HMAC IP 供限流使用；不要重用其他服務的秘密。

`ADMIN_EMAILS` 輸入逗號分隔的實際管理者信箱，須同時符合 Access policy；這份名單不會透過公開 API 傳回。

Server-side Siteverify 檢查 `success`、正式 hostname、`register` / `report` action。服務無法驗證時拒絕送出，不會降級繞過。

## 5. Migration 與部署

```bash
npm run check
npm audit
npm run db:remote
npm run deploy
```

`npm run build` 是本機打包驗證，不上傳；`npm run deploy` 才會發布。Secrets 不寫進 repository；Wrangler 會將 vars 與排程隨部署更新。

部署檢查只檢查 repo 設定，不證明 Cloudflare 外部 Access policy、secrets、DNS、Turnstile、Google OAuth client 或方案額度已正確設定。必須完成以下實站測試。

### 上線驗收

1. 無痕瀏覽首頁、場地與資料使用說明；確認主辦、保存期限、日期、直播連結正確。
2. 未登入直接訪問 `/admin/`、`/admin/index.html`、`/api/admin/venues`、`/api/admin/reports`，應進 Access 或被拒絕；一般站台仍公開。
3. allowlist 管理者能登入；其他帳號無法登入；確認後台 API 與頁面都使用相同 Access application。
4. 開放登記後，先確認未登入不能送出；以實際 Google 帳號登入，確認 Email 自動帶入且唯讀，再用真實 hostname 完成 Turnstile 登記測試資料。後台應顯示 Google 帳號、驗證時間；未審核前公開列表不能找到，也不能取得任何 Google 身分欄位。登出後原 Session 無效；驗證取消登入與過期回呼能回到前台顯示可重試訊息。
5. 後台審核上架，搜尋、手機顯示、地圖、預約、分享及回報皆正常；修改／下架最多 30 秒後生效。
6. 關閉 `REGISTRATION_OPEN` 後不能再提交；缺 token、偽造 token、錯誤 Origin、超額或超大 body 被拒絕。
7. 刪除測試登記與回報，確認操作紀錄；保持公開頁面沒有虛構店家。
8. 完成後確認 Cron 每天 `19:17 UTC`（台北時間翌日 `03:17`）執行。期限採 UTC 日期；到期後最多約 24 小時內執行刪除。首次部署時間若已超過期限，登記會保持關閉。

## 6. GitHub CI/CD

- `ci.yml` 在 push / pull request 執行型別檢查、API 安全測試、打包與桌面／手機 E2E。
- `deploy.yml` 僅手動 workflow_dispatch、且 branch 必須是 `main`，避免未審閱變更自動發布。
- 建立 GitHub `production` environment，可設定 required reviewers。Environment secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`。
- Token 僅授權此帳號的 Workers Scripts Edit、D1 Edit 與此 zone 部署自訂網域必要權限。初次 domain setup 可由本機完成，之後縮小 CI token 權限；依 Cloudflare 的實際權限需求補上，勿使用 Global API Key。
- 首次 Turnstile/IP/管理者名單/Google client secrets 仍透過 Wrangler secret put 安裝。CI 不輸出或讀回秘密。
- Migration 先於新 Worker 發布；既有 migration 不修改。未來新增欄位需向後相容，防止部署失敗時舊版本無法運作。

## 7. 防濫用與免費額度

- 公開 HTML/JS/CSS 走免費 static assets；API 執行 Worker，快取命中也仍計 Worker request。場地列表由邊緣快取 30 秒，減少 D1 讀取；搜尋組合太多會減少命中率。
- 寫入每 IP 每分鐘 5 次、API 讀取每 IP 每分鐘 120 次。Cloudflare Rate Limit binding 是各 Cloudflare location 的近似計數，不是全球精確封鎖；不得宣稱可擋住分散式攻擊。
- D1 的原子 upsert 對全站每日收件設上限，Turnstile 驗證過後才動到計數。預設每天 UTC 重置；失敗於計數後的請求也可能消耗名額，採保守保護。
- 每個 Google `sub` 每日最多登記 3 個場地，換 IP、重新登入或改 Email 不會重置。同時每天全站最多啟動 2,000 次 Google 登入，避免 OAuth 暫存資料無限制寫入；這些登入名額也可能遭耗盡，需與 IP 限流及 WAF 一起監看。
- 免費方案超額會出現服務錯誤；設定 Cloudflare 帳號通知，觀察 Workers Requests/Errors、D1 Rows read/written/Storage 與 Turnstile solve/error rate。Access、Turnstile、D1、Workers 均需留意各自方案限制。
- 若預期選前之夜有大量 API 流量，可事先經預算核准升級；不得只依免費額度承諾高可用。
- Zone WAF 可對 `/api/venues`、`/api/reports` 的 POST 加更前面的規則與速率限制，但依帳號方案可用規則數量決定。不要對全站或所有 POST 無差別 challenge，以免阻擋正常登記或 Access 登入。既有 Turnstile 不能取代 DDoS/WAF。

## 8. 緊急應變、備份與刪除

**垃圾登記／配額被耗盡**：將 `REGISTRATION_OPEN=false` 並重新部署；配合 WAF 封鎖明確異常來源。仍可瀏覽已上架場地。若需停用回報，使用 WAF 暫時阻擋 `/api/reports` POST。不要僅因政治立場或單筆回報封鎖／下架，依可驗證的冒名或濫用行為處理。

**錯誤場地**：後台下架並記錄原因，公開快取最多約 30 秒。已被其他人轉載的資料無法由本站撤回。

**管理帳號遭入侵**：撤銷 Access session、移除 allowlist、重設 IdP/MFA，檢查 audit_log 與 Cloudflare 帳號活動，視情況輪替 API token 與 secrets。

**備份**：Cloudflare D1 有 Time Travel；保留窗口依方案為準。另可在管理者受控裝置匯出 SQL：

```bash
mkdir -p backups
npx wrangler d1 export DB --remote --output backups/event.sql
```

匯出包含姓名、電話、Email、Google 帳號識別、Session 雜湊、暫存 OAuth 請求與內部備註；`backups/` 已排除 Git。請加密保存、限制權限、訂定與活動一致的刪除日期，不可上傳到公開儲存空間。復原前先停收件並匯出現況，使用新 DB 驗證後才切換；復原可能帶回先前已要求刪除的資料，必須重做刪除清單，並清除復原資料中的 merchant_sessions 與 oauth_states，避免復活舊登入狀態。

**活動結束**：關閉登記；依設定日期由 Cron 清除 venues / reports / audit_log / merchant_sessions / oauth_states / daily_intake。平時 daily_intake 只留最近 7 日，過期 Session 與 OAuth state 每日清理，授權檢查不會等待排程才失效。另清除人工匯出與其他服務的副本；D1 Time Travel 等復原窗口不受 SQL DELETE 立即清除，應事先在資料使用說明告知。
