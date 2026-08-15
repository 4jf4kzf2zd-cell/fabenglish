# FabEnglish

商用英文練習 PWA。**規格見 SPEC.md（唯一真相來源，改規格先改 SPEC.md）。**

## 專案慣例

- Vanilla JS ES modules，**零 runtime 依賴、零 build step**；部署 GitHub Pages
- 所有 iOS 語音 workaround 只放 `js/speech.js`；view 裡不准直接碰 `speechSynthesis`
- 所有 localStorage 讀寫只走 `js/store.js`；view 裡不准直接碰 `localStorage`
- 「今天」一律用 `srs.today()`，**不要直接 `new Date()`**（dev 時間旅行靠這個）
- 內容只放 `content/*.json`，改 schema 要同步改 `scripts/validate.js`
- UI 繁體中文；學習內容英文＋繁中翻譯
- commit 前跑 `node scripts/validate.js`
- 完成每個功能後更新 SPEC.md 第 7 節的驗收 checkbox

## 常用指令

```bash
npm run serve      # http://localhost:8080（localhost 會自動進 dev 模式）
npm run validate   # 驗證 content/*.json
npm test           # scoring.js + daily.js/store.js/plan.js + merge.js（48 + 149 + 40 項）
npm run icons      # 重新產生 icons/（改圖案時才需要）
PUPPETEER_DIR=E:/ClaudeCode/print2ai node scripts/smoke.mjs         # 155 項無頭測試（選用）
PUPPETEER_DIR=E:/ClaudeCode/print2ai node scripts/test-sync-e2e.mjs # 19 項兩裝置同步（需網路）

npm run worker:deploy   # 部署同步後端（worker/，Cloudflare Worker + D1）
```

> ES modules 與 fetch 不能用 `file://` 開，一定要走 http。

## 目前進度

**M1 / M2 / M3 / M4 / M5 / M6 / M7 全部完成**，SPEC 第 7 節的自動化驗收項目都已打勾，只剩需要 iPhone 實機的項目
（以及 M7 的 Google OAuth 用戶端 ID，要 Jerry 在 Google Cloud Console 建一組，步驟見 `worker/README.md`）。

- M1：Shell/路由/首頁、單字 SRS、閱讀、進度＋匯出匯入、TTS、設定、PWA
- M2：跟讀（`js/scoring.js` ＋ `js/shadow.js`）、Email 句型（cloze）、簡報句型（含簡報模式）、聽力（四階段＋數字聽寫）
- M3：內容補滿、streak 提示（首頁卡片＋`js/badge.js` PWA 圖示數字）、弱點清單匯出 markdown（`js/weakness.js`）
- M4：面試常見問題（`js/views/interview.js`＋模擬面試）、循環聽（`js/views/loop.js`）、
  跟讀改成直接錄音且**不顯示分數**、各練習可回上一題
- M5：每日任務（`js/daily.js`＋首頁改版）、schema v2（`daily` 每日紀錄）、儲存空間持久化、
  循環聽背景播放嘗試（`js/wake.js`）、badge 改成未完成任務數
- M6：面試衝刺（`js/plan.js` 42 天課表＋`#/sprint` 六週地圖）、schema v3（`sprint`）、
  **對話練習 `#/interview/talk`**（抽 3 題自我介紹／經歷，每題追問三層）、
  `SPEAKING.md` 面試場景 S6–S9、interview 題庫補到 67 題
- M7：多裝置同步（`js/merge.js` 逐欄合併＋`js/sync.js`＋`#/account`）、schema v4（`stamps`）、
  同步後端 `worker/`（Cloudflare Worker + D1，網址 `fabenglish-sync.jerrywu0800.workers.dev`）
- 內容：vocab **600**（A200/B250/C150）／readings **30**／email **30**／presentation **40**／listening **15**／interview **67**

往後主要是加內容與微調，不要再擴功能。附錄 B 已經破例兩次（M6 衝刺、M7 同步），都由 Jerry 指定；
那張表寫了界線在哪，再有新想法先回頭看。

## 關鍵不變條件

1. `scoring.js` 是純函式，不准 import 任何瀏覽器 API —— 這樣才能用 node 直接測。
2. 聽寫題的 `answer_display` 必須能被 `checkDictation` 判對，`validate.js` 會強制檢查。
   寫題目時避開會被誤判成數字的字（句首的 "One"、機台代號 F02、8D 這種英數混排）。
3. `badge.js` 在不支援的環境要全程靜默，不可以在 UI 上報錯。
4. **不要用 PowerShell 的字串取代去改含中文的檔案**，會把 UTF-8 毀成亂碼；一律用 Edit 工具。
5. **跟讀分數不准出現在任何 UI**（辨識誤差太大會誤導）。分數只在內部保留，用來排弱點順序。
6. 面試題的 `core` 必須是 `answer` 裡真的出現的句子且 ≤ 28 字，否則跟讀對不上；`validate.js` 會擋。
7. 每日任務**一天就是三項**，不要加第四項；重做已完成的東西不准重複計入（否則同一句跟讀五次就達標）。
8. `wake.js` 的背景播放是**盡力而為**，不是保證。任何文案都不准寫成「鎖屏一定會繼續播」。
9. 衝刺模式的「第幾天」一律由**面試日反推**（`plan.status()`），不是從開始日累加；
   改這條規則會讓面試日提前的人卡在第 1 天。
10. 語音模擬日（S6–S9）**不准做成第四項任務**。它發生在 Claude 語音裡，App 判定不到，
   而每日任務不做手動打勾——只能是提示。
11. **各主題同時進行**：衝刺課表是「一張每週都一樣的七天骨架 × 每週參數」（`PATTERN` + `WEEKS`），
   每週都涵蓋面試／閱讀／聽力／Email／跟讀／循環聽，自我介紹每週都滾一次。
   不要把閱讀或聽力整週抽掉——Jerry 已經否決過一次分段式。
12. **前三週的面試格是對話練習**（`WEEKS[].talkWeek`），只練自我介紹／自我經歷／工作經歷；
   第 4 週起才展開動機、技術、行為、薪資反問。這是 Jerry 指定的優先順序，
   代價是技術題與行為題只剩兩週，不要當成排程失誤「修好」。
13. 對話練習的追問是**題庫裡預錄的**，不是即時生成（App 沒有 LLM）。
   文案不准寫成「和 AI 對話」；真的雙向對話一律導到 `SPEAKING.md`。
14. **localStorage 永遠是唯一真相**，雲端只是備份與傳遞管道。
   不准出現「要先登入才能用」的畫面；同步失敗一律只更新狀態列，不擋任何練習流程。
15. 同步是**合併不是覆蓋**。改 `merge.js` 一定要同時維持三個性質：交換律（誰先上傳結果一樣）、
   冪等（重複同步不累加）、只前進不倒退。每條規則都要有 `test-merge.mjs` 的測試——
   合併寫錯會靜默吃掉進度，使用者只會發現昨天練的不見了。
16. 版本衝突回 **200 + `conflict:true`**，不要改回 409。兩台同時開著本來就會撞，
   回 4xx 會讓瀏覽器在 console 印紅字，「console 零錯誤」這條驗收就失去意義了。
17. session token 存在 `fabenglish.auth.v1`，**不准併進進度 blob**——匯出的備份會外流身分。

## 邊界（附錄 B）

不做：LLM API 對話、真人音檔、多使用者、成就系統、社群功能。
自由對話式口說不在 App 內，用 `SPEAKING.md` 的場景在 Claude Project 語音練。

後端／帳號／雲端同步已在 M7 破例，但**只用來搬一包進度 JSON**：
後端不看內容、不做計算、沒有第二個使用者。不要因為「反正有後端了」就往下加功能。
