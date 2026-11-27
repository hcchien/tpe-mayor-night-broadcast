# 專案下架與停止維護紀錄

2026-11-27 專案標示為 **DEPRECATED**，停止維護並移除線上服務。程式碼僅供歷史參考，不再提供功能或安全性更新。

## 已刪除的線上資源

- Cloudflare Pages 專案，包含部署、資產、Functions 與自訂網域綁定。
- Cloudflare Worker，包含部署、設定、secrets 與排程。
- 專案專用 D1 資料庫與其中資料。
- 專案專用 Turnstile 小工具。
- GCP DNS 中的網站專用 CNAME。
- 網站專用 Google OAuth client。

已在各平台清單確認資源移除。其他專案、DNS 記錄、OAuth client 與共用品牌設定未更動。

## GitHub

- Cloudflare 部署 workflow 已停用。
- production environment 與其中部署 secrets 已刪除。
- Repository 描述、topic 與 README 已標示 deprecated。

## 程式碼清理

- 移除部署 workflow、Pages gateway 與其部署設定、部署前檢查及 Pages 建立腳本。
- 移除遠端部署與資料庫 migration 指令。
- CI 保留各分支 push 與 pull request 檢查，不取得部署憑證。
- Wrangler 改為本機設定，使用佔位資料庫 ID、本機 origin、測試 Turnstile key、空 Google client ID，並移除遠端排程。
- 保留應用程式、migrations 與本機測試。build 指令只做 dry-run 打包。

## 驗證

本機 npm run check 通過：TypeScript、37 項測試與 Worker dry-run 打包。git diff --check 通過。
