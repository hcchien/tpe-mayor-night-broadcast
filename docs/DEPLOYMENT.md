# Cloudflare 部署與維運

## 1. 準備帳號與網域

使用 Cloudflare Pages、Workers Free、D1 與 Turnstile 免費額度。DNS 保留在 GCP Cloud DNS。

- 公開站：`https://tpe-mayor.thecocoa.cool`，Pages 專案 `tpe-mayor-night-broadcast`。
- 後台：`https://tpe-mayor.thecocoa.cool/admin/`，使用 Google OAuth，伺服器只允許 `ADMIN_EMAILS` 中且為 Google 權威信箱的帳號。
- Pages gateway 以 `APP` service binding 呼叫私有 Worker。Worker 無公開 routes、workers.dev 或 preview URL；所有請求先經過 Worker 權限檢查。
- 公開專案的 pages.dev 與所有預覽 hostname 被 gateway 拒絕。沒有另外的後台 Pages 或 Zero Trust 訂閱。


```bash
npm ci
npx wrangler login
# 已建立的 D1 UUID 在 wrangler.jsonc，勿重複建立
npx wrangler pages project create tpe-mayor-night-broadcast --production-branch main
```

首次發布 Worker 後才能建立 Pages service binding。先在公開 Pages 專案加入 Custom domain `tpe-mayor.thecocoa.cool`，再於 GCP Cloud DNS 新增該子網域的 CNAME 指向實際核配的 `<project>.pages.dev.`。不可只加 DNS 而省略 Pages domain 關聯。如果 Pages 核配不同名稱，更新設定及 CNAME。

不要搬動整個 `thecocoa.cool` DNS。若同名 DNS 記錄已存在，先確認用途，不能直接覆蓋。

## 2. 公開設定

編輯 `wrangler.jsonc` 的 `vars`。此檔公開於 repo，**不要放秘密**。

| 變數 | 設定 |
| --- | --- |
| `SITE_ORIGIN` | `https://tpe-mayor.thecocoa.cool`，須與公開 Pages ALLOWED_ORIGIN 相符 |
| `ENVIRONMENT` | 固定 `production` |
| `EVENT_LABEL` | 活動名稱（供 API；首頁目前採台北市長選前之夜固定文案） |
| `EVENT_TIME` | 顯示日期、時間與時區，例如由主辦確認的台北時間；勿用未確認資訊 |
| `LIVESTREAM_URL` | 官方直播 HTTPS 網址，尚未確定留空 |
| `ORGANIZER_NAME` | 選填，留空時不顯示主辦／個資管理者名稱 |
| `CONTACT_EMAIL` | 選填，公開聯絡信箱；與不公開的管理員白名單分開 |
| `PRIVACY_DELETE_AFTER` | 選填，`YYYY-MM-DD` UTC 日期，該日結束後排程刪除；留空不啟用活動資料的定期刪除，過期登入狀態仍照常清理 |
| `REGISTRATION_OPEN` | 初次 `false`；實站驗證完成才改 `true` |
| `DAILY_SUBMISSION_LIMIT` | 預設 `200`，最多 `1000`；店家登記與問題回報分別各自計數 |
| `TURNSTILE_SITE_KEY` | 正式 widget 的公開 site key |
| `GOOGLE_CLIENT_ID` | Google OAuth「Web application」類型的 Client ID，結尾為 `.apps.googleusercontent.com` |

`ADMIN_EMAILS` 以 secret 儲存（第 4 節），不放入公開 repo。

`ratelimits` 的 namespace ID 在同一帳號應為本網站獨有；若 `1826301001` / `1826301002` 已被其他 Worker 使用，換成未使用的正整數字串。

## 3. 管理員 Google 登入

後台與店家使用同一 Google OAuth client。管理員允許名單設定為 Worker secret `ADMIN_EMAILS=hcchien@reviz.tw`。伺服器每次讀寫都驗證 Session 及允許名單。Google Workspace 帳號必須回傳 `hd`，一般非 Google 管理的外部信箱不能作管理員。

Cloudflare Zero Trust 的免費啟用畫面要求綁卡與超額扣款授權，本專案不依賴該訂閱。

## 3a. Google OAuth

1. 在 Google Cloud 專案的 Google Auth Platform 建立此網站專用的 OAuth client，類型為 **Web application**。不共用 CMS 或其他專案的 client secret。
2. Audience 設為 External，此專案已與其他應用共用 reviz 品牌，不任意改名或覆蓋既有應用品牌。若另設專用 project，設定真實的 app name、支援信箱、首頁 `https://tpe-mayor.thecocoa.cool/`、隱私政策 `https://tpe-mayor.thecocoa.cool/privacy.html` 與已驗證的 authorized domain。
3. Authorized redirect URI 必須完全一致：`https://tpe-mayor.thecocoa.cool/api/auth/callback`。本實作是後端 authorization code flow，不靠 JavaScript SDK，也不需將 Google script 加入 CSP。
4. 僅使用 `openid email`，不要求 profile、Gmail、Drive 或 offline access。依 Google 控制台顯示完成必要的 branding／verification 要求；Google 官方文件說明：僅要求基本身分 scopes（openid/email/profile）時，即使為 Testing 也不受 test users 名單限制，但可能顯示測試提示，Workspace 管理員仍可封鎖。對外招募前須確認一般外部帳號可登入。不要因為 scopes 少就假定不會有品牌審核或警告。
5. Client ID 填入 `GOOGLE_CLIENT_ID`；client secret 用 `wrangler secret put GOOGLE_CLIENT_SECRET` 安裝，不提交至 Git。
6. `/api/auth/*` 必須保持可由公開訪客連線，不能阻擋未登入者；它有獨立的伺服器驗證。一般店家帳號沒有 `/api/admin/*` 權限。
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

`ADMIN_EMAILS` 輸入逗號分隔的實際管理者信箱，僅允許 Google Workspace 或 Gmail 權威信箱；這份名單不會透過公開 API 傳回。

Server-side Siteverify 檢查 `success`、正式 hostname、`register` / `report` action。服務無法驗證時拒絕送出，不會降級繞過。

## 5. Migration 與部署

```bash
npm run check
npm audit
npm run db:remote
npm run deploy
```

`npm run build` 是本機打包驗證，不上傳；`npm run deploy` 依序發布私有 Worker及公開 Pages gateway。Secrets 不寫進 repository；Wrangler 會將 vars 與排程隨部署更新。

部署檢查只檢查 repo 設定，不證明 Cloudflare 外部 secrets、DNS、Turnstile、Google OAuth client 或方案額度已正確設定。必須完成以下實站測試。

### 上線驗收

1. 無痕瀏覽首頁、場地與資料使用說明；確認選填主辦與保存設定、日期、直播連結正確。
2. 未登入直接訪問 `/admin/`、`/admin/index.html`、`/api/admin/venues`、`/api/admin/reports`，頁面應導向管理登入、API 應被拒絕；一般站台仍公開。
3. allowlist 管理者能登入；其他帳號無法登入；確認移除允許名單後，既有 Session 也立即失去管理權限。
4. 開放登記後，先確認未登入不能送出；以實際 Google 帳號登入，確認 Email 自動帶入且唯讀，再用真實 hostname 完成 Turnstile 登記測試資料。後台應顯示 Google 帳號、驗證時間；未審核前公開列表不能找到，也不能取得任何 Google 身分欄位。登出後原 Session 無效；驗證取消登入與過期回呼能回到前台顯示可重試訊息。
5. 後台審核上架，搜尋、手機顯示、地圖、預約、分享及回報皆正常；修改／下架最多 30 秒後生效。
6. 關閉 `REGISTRATION_OPEN` 後不能再提交；缺 token、偽造 token、錯誤 Origin、超額或超大 body 被拒絕。
7. 刪除測試登記與回報，確認操作紀錄；保持公開頁面沒有虛構店家。
8. 完成後確認 Cron 每天 `19:17 UTC`（台北時間翌日 `03:17`）執行。期限採 UTC 日期；到期後最多約 24 小時內執行刪除。首次部署時間若已超過期限，登記會保持關閉。

## 6. GitHub CI/CD

- `ci.yml` 在非 main 分支 push、pull request 時執行型別檢查、API 安全測試、打包與桌面／手機 E2E，也透過 `workflow_call` 提供部署流程重用。PR 不會部署或取得 Cloudflare secrets。
- `deploy.yml` 在 **push 到 main（包含合併 PR）** 後自動啟動，亦保留 Actions → Cloudflare CI/CD → Run workflow 的手動入口。僅 main 可部署。
- 部署 workflow 先呼叫相同 commit 的 `ci.yml`，`deploy` job 以 `needs: check` 等待全部通過；失敗即停止。避免依賴另一個 workflow 的不明版本結果，也不重複執行 main 的 CI。
- 通過後在獨立 runner 執行 `npm ci` → 檢查正式設定與部署憑證 → D1 remote migrations → `npm run deploy`。測試使用獨立本機 DB 與 mock 登入，沒有 Cloudflare secrets；測試用 `.dev.vars` 不會帶入正式部署。
- 建立 GitHub `production` environment，加入兩個 Environment secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`。Environment 的 deployment branches 限定 main。若希望完全自動部署，不設定 required reviewers；若設定 reviewers，CI 通過後會等待核准才發布。建議 main 使用 branch protection，要求 PR 檢查通過才合併。
- Production deployment 共用 concurrency group，`cancel-in-progress: false`，避免新 push 中斷正在執行的 migration／發布。短時間多次 push 時，GitHub 可由最新執行取代仍在等待的執行，不保證每一個中間 commit 都部署。
- 使用這個 GitHub Actions 流程時，不要再為同一個 Worker 開啟 Cloudflare Workers Builds 的 main 自動部署，以免同一次 push 部署兩次或繞過這裡的測試。
- Token 僅授權此帳號的 Workers Scripts Edit、D1 Edit 與此 zone 部署自訂網域必要權限。初次 domain setup 可由本機完成，之後縮小 CI token 權限；依 Cloudflare 的實際權限需求補上，勿使用 Global API Key。
- 首次 Turnstile/IP/管理者名單/Google client secrets 仍透過 Wrangler secret put 安裝。CI 不輸出或讀回秘密。
- Migration 先於新 Worker 發布；既有 migration 不修改。未來新增欄位需向後相容，防止部署失敗時舊版本無法運作。

首次啟用順序：完成前述正式 Cloudflare／Google 設定與 Worker secrets → 填好 wrangler.jsonc → 建立 GitHub production environment 與部署 secrets → commit/push 至 main。到 GitHub Actions 確認 check 與 deploy 都成功，再依上線驗收逐項檢查。此 repository 的設定檔仍含佔位值時，部署會明確失敗，不會略過檢查。

## 7. 防濫用與免費額度

- 公開 HTML/JS/CSS 走免費 static assets；API 執行 Worker，快取命中也仍計 Worker request。場地列表由邊緣快取 30 秒，減少 D1 讀取；搜尋組合太多會減少命中率。
- 寫入每 IP 每分鐘 5 次、API 讀取每 IP 每分鐘 120 次。Cloudflare Rate Limit binding 是各 Cloudflare location 的近似計數，不是全球精確封鎖；不得宣稱可擋住分散式攻擊。
- D1 的原子 upsert 對全站每日收件設上限，Turnstile 驗證過後才動到計數。預設每天 UTC 重置；失敗於計數後的請求也可能消耗名額，採保守保護。
- 每個 Google `sub` 每日最多登記 3 個場地，換 IP、重新登入或改 Email 不會重置。同時每天全站最多啟動 2,000 次 Google 登入，避免 OAuth 暫存資料無限制寫入；這些登入名額也可能遭耗盡，需與 IP 限流及 WAF 一起監看。
- 免費方案超額會出現服務錯誤；設定 Cloudflare 帳號通知，觀察 Workers Requests/Errors、D1 Rows read/written/Storage 與 Turnstile solve/error rate。Turnstile、D1、Workers 均需留意各自方案限制。
- 若預期選前之夜有大量 API 流量，可事先經預算核准升級；不得只依免費額度承諾高可用。
- Zone WAF 可對 `/api/venues`、`/api/reports` 的 POST 加更前面的規則與速率限制，但依帳號方案可用規則數量決定。不要對全站或所有 POST 無差別 challenge，以免阻擋正常登記或 Google 登入。既有 Turnstile 不能取代 DDoS/WAF。

## 8. 緊急應變、備份與刪除

**垃圾登記／配額被耗盡**：將 `REGISTRATION_OPEN=false` 並重新部署；配合 WAF 封鎖明確異常來源。仍可瀏覽已上架場地。若需停用回報，使用 WAF 暫時阻擋 `/api/reports` POST。不要僅因政治立場或單筆回報封鎖／下架，依可驗證的冒名或濫用行為處理。

**錯誤場地**：後台下架並記錄原因，公開快取最多約 30 秒。已被其他人轉載的資料無法由本站撤回。

**管理帳號遭入侵**：從 D1 撤銷對應 merchant_sessions、移除 allowlist、重設 IdP/MFA，檢查 audit_log 與 Cloudflare 帳號活動，視情況輪替 API token 與 secrets。

**備份**：Cloudflare D1 有 Time Travel；保留窗口依方案為準。另可在管理者受控裝置匯出 SQL：

```bash
mkdir -p backups
npx wrangler d1 export DB --remote --output backups/event.sql
```

匯出包含姓名、電話、Email、Google 帳號識別、Session 雜湊、暫存 OAuth 請求與內部備註；`backups/` 已排除 Git。請加密保存、限制權限、訂定與活動一致的刪除日期，不可上傳到公開儲存空間。復原前先停收件並匯出現況，使用新 DB 驗證後才切換；復原可能帶回先前已要求刪除的資料，必須重做刪除清單，並清除復原資料中的 merchant_sessions 與 oauth_states，避免復活舊登入狀態。

**活動結束**：關閉登記；依設定日期由 Cron 清除 venues / reports / audit_log / merchant_sessions / oauth_states / daily_intake。平時 daily_intake 只留最近 7 日，過期 Session 與 OAuth state 每日清理，授權檢查不會等待排程才失效。另清除人工匯出與其他服務的副本；D1 Time Travel 等復原窗口不受 SQL DELETE 立即清除，應事先在資料使用說明告知。

Google 基本身分 scopes 的 Testing 例外：[官方說明](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)。
