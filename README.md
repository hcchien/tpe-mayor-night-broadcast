# 一起看・台北｜選前之夜聯播場地

讓全台 22 縣市（含離島）的店家登記參與聯播，民眾搜尋已查核場地、自行揪團並透過店家連結訂位。沒有預設候選人、日期、直播網址或假店家資料；活動資訊由部署設定提供。

## 功能

- 店家可複選「市民（選前）之夜」與「開票之夜」，至少一場；公開場地卡顯示參與活動，搜尋可依活動篩選，後台可修改。兩晚安排不同時，請在開放時間、消費與參與須知分別註明。
- `0005_venue_events.sql` 將原有登記歸入「市民（選前）之夜」，不自動加入開票之夜；活動選擇有 API 與資料庫驗證。

- 手機／桌面版首頁、縣市／鄉鎮市區／類型／無階梯入口篩選、店名與地址搜尋、分頁、Google Maps 導航及分享。
- 登記、搜尋與後台編輯皆使用縣市連動的鄉鎮市區選單；更換縣市時清空鄉鎮市區，後端驗證配對。
- 店家先以 Google OAuth 登入，再填寫容量、設備、開放時間、低消、預約連結、聯絡資料與個資告知同意。Email 自動帶入、不能冒用別人信箱；每帳號每日最多 3 筆。
- 所有登記預設 `pending`；只有 `approved` 場地進入公開 API，聯絡資料永不公開。
- `/admin/`：人工查核、編輯、通過、拒絕、下架、永久刪除；回報處理與最近 100 筆操作紀錄。
- Google OAuth＋伺服器端管理者 Email 名單、Turnstile、限流、全站每日收件上限、CSRF／XSS／SQL 注入防護。
- 店家與管理者權限分離：Google 登入只允許登記，不會取得後台權限。Google 帳號驗證不等於店家所有權驗證，仍需人工查核。
- D1 migration、資料到期刪除排程、部署前檢查，以及 GitHub Actions：push 到 main 後通過 CI 即自動部署 production，也可手動觸發。

## 架構

DNS 保留在 GCP；公開與後台各用一個 Cloudflare Pages gateway，透過 service binding 呼叫私有 TypeScript Worker。靜態 HTML/CSS/JavaScript 由 Workers Static Assets 提供，所有路徑先執行 hostname 與後台權限檢查。資料存 D1，沒有需要常駐的伺服器。前端無框架、外部字型、廣告或分析追蹤碼。店家與管理者輸入用 DOM `textContent` 顯示，沒有 HTML 注入渲染。

使用 Cloudflare 免費資源起步。目前 gateway 會處理所有請求（包含靜態資產），因此計入動態請求額度；Worker 在 Free 方案有每日 100,000 請求額度，D1 每日 500 萬列讀取、10 萬列寫入、帳戶合計 5 GB 儲存（個別 DB 上限另見官方限制）。超額可能停止服務，不能保證大型流量或攻擊下仍維持可用。請參閱 [部署文件](docs/DEPLOYMENT.md) 與 [安全設計](docs/SECURITY.md)。

行政區資料取自[內政部國土測繪中心戶政鄉鎮市區清單](https://data.gov.tw/dataset/102011)，採政府資料開放授權條款第 1 版。`src/locations.ts` 保存 2026-11-26 的 22 縣市、368 鄉鎮市區快照；前後端共用，不需即時呼叫外部服務。更新時請同步核對官方清單並執行測試。

## 本機開發

需要 Node.js 24（建議 LTS）、npm 與可啟動 localhost 服務的環境。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

開啟 `http://127.0.0.1:8787`；後台在 `/admin/`。`.dev.vars` 只供本機，不會提交；正式秘密使用 `wrangler secret put`。

本機略過 管理員驗證／Turnstile／限流僅在以下三者同時成立時有效：`ENVIRONMENT=development`、`LOCAL_DEV_AUTH=true`、請求來自 **HTTP loopback 主機名稱**。店家仍需點擊「本機模擬 Google 登入」，使用 `merchant@example.com` 建立可登出／撤銷的測試 Session；這不是實際 Google 驗證。Wrangler 開發伺服器只監聽 `127.0.0.1`。請勿用 tunnel 將此開發模式公開。

## 驗證

```bash
npm run check              # TypeScript + SQLite/API/安全測試 + Worker 打包
npx playwright install chromium
npm run test:e2e           # 自動啟動 Wrangler；須先準備 .dev.vars
```

API 測試實際載入 migration 並執行 SQLite SQL，驗證完整審核生命週期、資料分離、併發版本衝突、限流及刪除；安全測試簽署真實 RSA JWT 驗證拒絕情境。瀏覽器測試包括手機／桌面、登記→審核→回報→下架→刪除，以及 XSS 文字安全渲染。

在限制 socket 的執行環境，Wrangler 本機 D1 與 Playwright E2E 可能出現 `listen EPERM`；可先跑 `npm run check`，完整 E2E 由具 localhost 權限的開發環境或 GitHub CI 執行。離線安裝不能取代最新依賴漏洞稽核；上線前另跑 `npm audit`。

## 首次部署

完整步驟見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。大致順序：建立 D1 → 填入網域與活動資料 → 設定 Google OAuth、管理員允許名單與 Turnstile → 上傳 secrets → migration → deploy → 實站驗證 → 開放登記。

```bash
npx wrangler login
npx wrangler d1 create tpe-mayor-night-broadcast
# 將回傳的 database_id 寫入 wrangler.jsonc；完成 docs/DEPLOYMENT.md 的其他設定
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put IP_HASH_SECRET
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run db:remote
npm run deploy
```

`npm run deploy` 會拒絕佔位設定或開發驗證模式。repo 包含正式 hostname 與 D1 ID 等公開設定，管理者白名單與正式金鑰使用 secrets。主辦、聯絡信箱與資料刪除日期選填；空日期表示活動資料須由管理者刪除。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `pages/` | 公開 Pages gateway、私有 Worker service binding |
| `public/` | 前台、隱私說明、後台與安全標頭 |
| `src/index.ts` | API、D1 存取與排程刪除 |
| `src/security.ts` | JWT、Turnstile、限流、Origin 與 body 限制 |
| `src/merchant-auth.ts` | Google code flow、PKCE、nonce、Session、帳號提交上限 |
| `src/schema.ts` | 資料驗證與公開欄位白名單 |
| `migrations/` | D1 schema；不可修改已上線 migration，應新增後續版本 |
| `tests/` | API／安全／瀏覽器測試 |
| `wrangler.jsonc` | Cloudflare 部署設定（維持合法 JSON，供 preflight 讀取） |
| `.github/workflows/` | PR 驗證、main 自動部署與手動部署入口 |

## 官方參考

- [Workers Static Assets 計價](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 計價](https://developers.cloudflare.com/d1/platform/pricing/)
- [Turnstile 伺服器驗證](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google ID token 與 Email 驗證限制](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

授權：MIT（見 LICENSE）。
