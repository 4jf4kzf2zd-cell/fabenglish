# FabEnglish 同步後端

Cloudflare Worker + D1，負責在多台裝置之間傳遞一包進度 JSON。
**合併規則不在這裡**——在前端 `js/merge.js`（見 SPEC §4.12）。

- 網址：https://fabenglish-sync.jerrywu0800.workers.dev
- D1：`fabenglish`（`2e766f6e-04e9-40d2-bbc5-065351b375a7`）

```bash
npm run worker:deploy     # 部署
npm run worker:schema     # 建表（重跑安全，都是 IF NOT EXISTS）
npm run worker:tail       # 看即時 log
```

## 開通 Google 登入（唯一需要手動做的一步）

Worker 部署好就能用配對碼同步了；Google 登入還差一組 OAuth 用戶端 ID。
`GOOGLE_CLIENT_ID` 是空字串時，`/auth/google` 一律回 503，其他功能不受影響。

1. 開 https://console.cloud.google.com/apis/credentials （用 jerrywu0800@gmail.com）
2. 沒有專案就先建一個，隨便命名（例如 `fabenglish`）
3. 左邊「OAuth 同意畫面」→ User Type 選 **外部** → 填 App 名稱與聯絡信箱 → 儲存
   （不用送審。發布狀態留在「測試」也可以，記得把自己的 Gmail 加進測試使用者）
4. 「憑證」→ 建立憑證 → **OAuth 用戶端 ID** → 應用程式類型選 **網頁應用程式**
5. 「已授權的 JavaScript 來源」加這三筆（**不要加路徑**）：
   - `https://4jf4kzf2zd-cell.github.io`
   - `http://localhost:8080`
   - `http://127.0.0.1:8080`
6. 「已授權的重新導向 URI」留空（用的是 Google Identity Services，不走 redirect）
7. 建立後複製那串 `xxxxx.apps.googleusercontent.com`，貼到兩個地方：
   - `worker/wrangler.toml` 的 `GOOGLE_CLIENT_ID`
   - `js/config.js` 的 `GOOGLE_CLIENT_ID`
8. `npm run worker:deploy`，然後把 `js/config.js` 一起 commit 部署

用戶端 ID 是公開資訊（本來就會出現在網頁原始碼裡），不是密鑰，可以進 git。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/health` | 健康檢查；唯一不用 app key 的端點 |
| POST | `/account` | 建立帳號（不用 Google） |
| POST | `/auth/google` | Google 登入／註冊；帶著現有 session 就是把該帳號綁上 Google |
| GET | `/progress` | 取回 `{rev, blob, updatedAt}` |
| PUT | `/progress` | 上傳 `{baseRev, blob}`；rev 對不上回 409＋雲端現況 |
| POST | `/link/code` | 產生配對碼（15 分鐘、用完即失效） |
| POST | `/link/claim` | 用配對碼把這台裝置綁到同一個帳號 |
| POST | `/logout` | 撤銷這個 session |

除 `/health` 外都要帶 `X-Fab-App: <APP_KEY>`；需要身分的端點另外帶 `Authorization: Bearer <token>`。

`APP_KEY` 不是安全機制（前端一定是明碼），只是擋掉隨機掃網址的機器人。
真正的授權靠 session token；session token 存在瀏覽器的 `fabenglish.auth.v1`，
**不會**被寫進進度備份，所以匯出的 JSON 給別人看也不會外洩身分。

## 資料

一個帳號一列，進度整包存 `accounts.blob`（正常幾十 KB，上限 512 KB）。
沒有練習內容、沒有錄音、沒有任何個人識別資訊，除了 Google 回傳的 email。
