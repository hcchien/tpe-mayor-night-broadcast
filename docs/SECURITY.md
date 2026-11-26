# 安全設計與已知限制

## 信任邊界

| 入口 | 驗證與權限 | 資料 |
| --- | --- | --- |
| 公開場地列表 | API 讀取限流、分頁、驗證條件、30 秒快取 | 僅 approved，明確欄位白名單，無私人聯絡資料 |
| 店家 Google 登入 | 同源 POST、state 與瀏覽器 Cookie 綁定、PKCE S256、nonce、Google RS256 ID token 驗證 | openid/email 最小 scopes；登入成功建立不透明 Session，無管理權限 |
| 店家登記 | Google Session、Email 綁定、同源 JSON、16 KiB body 上限、嚴格 schema、honeypot、Turnstile、IP／帳號／全站每日上限 | 一律 pending；不能由 payload 設定身分或審核狀態 |
| 問題回報 | 同源 JSON、Turnstile、限流與每日上限 | 僅接受現有已公開場地；不自動下架 |
| 管理頁／API | Access 邊緣 policy + Worker JWT 簽章／issuer／audience／到期／Email allowlist | 可審核、編輯、刪除；no-store |
| 資料庫 | Worker D1 binding，無對外 DB 帳密端點 | 所有動態值參數化；狀態與數值有 schema / SQL constraints |

## 實作重點

- Cloudflare Access 的 `Cf-Access-Authenticated-User-Email` 不可信任；只接受通過 RS256 JWT 驗證的 email claim。JWT 必須有 exp/iat/sub/email，且由設定的 issuer 對指定 audience 簽發。Email allowlist 每次請求檢查。
- 正式 `workers.dev` 與 preview URL 關閉；API 同時檢查 request origin 是否為設定網域。不使用管理 API key、前端 localStorage token 或自製長效 session。
- 店家 Session 為 256-bit 隨機 token，DB 只存 SHA-256，固定 12 小時有效，不自動 refresh。使用 `__Host-` Cookie 避免父網域覆寫、Secure + HttpOnly + SameSite=Lax；登入成功旋轉本站 Session，登出立即刪除 DB Session 並清 Cookie。Google 授權撤銷不會即時推送到此版本，既有 Session 最晚到期才失效。
- Google 身分使用穩定的 `sub` 綁定，不以 Email 當帳號主鍵；Email 必須由合法 ID token 提供，且 `email_verified === true`。nonce、aud／azp、issuer、exp、iat、簽章均驗證；回呼不接受前端自行宣告的身分。OAuth state 由原子 DELETE RETURNING 消耗，拒絕重送與不同瀏覽器的回呼。
- 新登記的原始 Google 帳號與驗證時間保留為私有快照；管理者更正聯絡 Email 不會改寫此快照。舊資料不自動補為已驗證。每帳號限額使用 Google sub 的雜湊計數。
- 寫入要求精確 `Origin` 與 JSON Content-Type，無跨網域 CORS。管理操作仍受相同限制。Token 本身不能繞過 CSRF。
- 前端不渲染任意 HTML；外部連結僅 HTTPS，禁止嵌入帳密，使用 noopener / noreferrer。沒有任意 URL 伺服器 fetch，不會因店家連結造成 SSRF。
- CSP 限定 self 與 Turnstile 來源，禁止 inline script、object、frame embedding；靜態資產透過 `_headers`，Worker 回應透過程式加上標頭。
- 請求 body 以串流逐段累計長度，即使沒有 Content-Length 也受限制。所有 schema 使用 strict，禁止 mass assignment。
- SQL 參數綁定、LIKE 通配字元跳脫；欄位／查詢片段只來自程式固定清單，不插入使用者指定 SQL。
- 審核用版本號做樂觀鎖；audit INSERT 與狀態 UPDATE 在同一 D1 batch transaction。衝突回傳 409，不產生虛假的成功紀錄。
- 刪除場地連帶刪除回報，操作紀錄只留下 UUID 與管理者，不複製店家聯絡資料；到保存期限連 audit 一起刪除。
- 伺服器錯誤只記錄隨機 request ID，不輸出 SQL、JWT、Turnstile token、body、IP 或聯絡資料。Cloudflare 平台日誌另受其設定影響。
- 原始 IP 不存 DB；使用每日 HMAC 值作 rate limit key。這是防濫用識別，不能宣稱平台完全不處理 IP。
- 程式與部署設定均預設 fail closed：無 secrets、無 admin 設定、Turnstile 故障、資料驗證失敗或過期，拒絕相應操作。

## 不能取代的人工工作

Google 登入證明有人控制該 Google 帳號，不能證明登記人擁有店家或有代理權。非 Gmail 且缺少 `hd` 的第三方信箱，Google 的 `email_verified` 也不能保證目前仍控制該信箱；後台會提示另行查核。上架前必須透過可獨立確認的店家官方聯絡方式核對授權、地址、設備與活動資訊，避免只相信登記人提供的電話。惡意連結即使是 HTTPS 也可能釣魚，應人工檢查官方網站／預約頁。

攻擊者仍可能人工填表、輪換 IP、消耗免費配額或提交大量不同查詢。應搭配 Cloudflare WAF、監看與必要的流量預算。本站沒有報名者名單、留言、付款、圖片上傳或公開編輯功能，減少不必要的攻擊面。

## 自動測試範圍

`npm test` 驗證 Access 偽造簽章／錯 issuer／錯 aud／過期／非管理者被拒絕；CSRF、超大 body、Turnstile hostname/action、欄位注入、非 HTTPS 連結、每日上限、私人欄位不公開、SQL LIKE 注入、審核版本衝突、完整 CRUD 與保存到期刪除。

`npm run test:e2e` 驗證桌面／手機登記與管理流程、字串 XSS 渲染與基本無水平溢出。這些測試不替代正式 Access policy、真實 Turnstile、Cloudflare binding、DNS 與負載測試，正式環境仍需依 DEPLOYMENT.md 驗收。

`tests/merchant-auth.test.ts` 額外驗證 Google JWT 錯誤簽章／issuer／aud／azp／nonce／期限、一次性 state、PKCE、瀏覽器綁定、code exchange 到 Session 的完整流程（Google HTTP 回應以測試金鑰模擬）、登出撤銷、Email 冒用被拒絕、Google 登入無法提升為管理員、跨 Session 帳號限額與個資清除。CI 的 Google UI 是明確標記的本機 mock，不能宣稱已測過真實 Google 同意頁。

## 依賴

執行期只使用 `jose` 與 `zod`。套件版本固定並提交 package-lock，CI 使用 npm ci。更新需跑型別、API、安全與 E2E 測試。離線環境無法取得最新 vulnerability advisory；發布前在有網路環境執行 npm audit 並審閱結果。
