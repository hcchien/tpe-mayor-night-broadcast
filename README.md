# [DEPRECATED] 一起看・台北｜選前之夜聯播場地

> **本專案已於 2026-11-27 下架並停止維護。** 不再提供線上服務、功能更新或安全性更新。程式碼僅供歷史參考，請勿直接用於正式環境。

## 下架狀態

- 已刪除 Cloudflare Pages、Worker、D1 資料庫與專用 Turnstile。
- 已刪除 `tpe-mayor.thecocoa.cool` 的 GCP DNS CNAME 與網站專用 Google OAuth client。
- GitHub Cloudflare 部署 workflow 已停用，`production` 環境與部署 secrets 已刪除。
- 正式部署指令與設定已移除；保留原始程式、migrations 與本機測試。

完整下架紀錄見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 歷史功能

網站原供全台 22 縣市店家登記「市民（選前）之夜」與「開票之夜」聯播場地，提供縣市／鄉鎮市區與活動搜尋、Google OAuth 登記，以及人工審核後台。前端為 HTML/CSS/JavaScript，後端使用 Cloudflare Workers 與 D1。

行政區資料取自[內政部國土測繪中心戶政鄉鎮市區清單](https://data.gov.tw/dataset/102011)，採政府資料開放授權條款第 1 版；`src/locations.ts` 保留 2026-11-26 的資料快照。

## 本機參考

使用 Node.js 24 與 npm：

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

開啟 `http://127.0.0.1:8787`，後台位於 `/admin/`。本機 mock 登入只供測試，請勿透過 tunnel 公開。`wrangler.jsonc` 僅保留本機設定與佔位資料庫 ID。

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run build` 只進行 dry-run 打包。歷史安全設計見 [docs/SECURITY.md](docs/SECURITY.md)，不代表此專案仍提供安全維護。

授權：MIT（見 LICENSE）。
