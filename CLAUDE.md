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
npm test           # scoring.js + daily.js/store.js/plan.js 單元測試（48 + 122 項）
npm run icons      # 重新產生 icons/（改圖案時才需要）
PUPPETEER_DIR=E:/ClaudeCode/print2ai node scripts/smoke.mjs   # 134 項無頭測試（選用）
```

> ES modules 與 fetch 不能用 `file://` 開，一定要走 http。

## 目前進度

**M1 / M2 / M3 / M4 / M5 / M6 全部完成**，SPEC 第 7 節的自動化驗收項目都已打勾，只剩需要 iPhone 實機的項目。

- M1：Shell/路由/首頁、單字 SRS、閱讀、進度＋匯出匯入、TTS、設定、PWA
- M2：跟讀（`js/scoring.js` ＋ `js/shadow.js`）、Email 句型（cloze）、簡報句型（含簡報模式）、聽力（四階段＋數字聽寫）
- M3：內容補滿、streak 提示（首頁卡片＋`js/badge.js` PWA 圖示數字）、弱點清單匯出 markdown（`js/weakness.js`）
- M4：面試常見問題（`js/views/interview.js`＋模擬面試）、循環聽（`js/views/loop.js`）、
  跟讀改成直接錄音且**不顯示分數**、各練習可回上一題
- M5：每日任務（`js/daily.js`＋首頁改版）、schema v2（`daily` 每日紀錄）、儲存空間持久化、
  循環聽背景播放嘗試（`js/wake.js`）、badge 改成未完成任務數
- M6：面試衝刺（`js/plan.js` 42 天課表＋`#/sprint` 六週地圖）、schema v3（`sprint`）、
  `SPEAKING.md` 面試場景 S6–S9、interview 題庫補到 62 題
- 內容：vocab **600**（A200/B250/C150）／readings **30**／email **30**／presentation **40**／listening **15**／interview **62**

往後主要是加內容與微調，不要再擴功能（附錄 B 的邊界仍然有效）。
M6 是**唯一一次**破例擴功能——因為有明確目標日期的排程是星期輪替做不到的事；再有新想法先回頭看附錄 B。

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
   不要改回「第 1 週只做自我介紹、第 3 週才碰技術」那種分段式——Jerry 已經否決過一次。

## 邊界（附錄 B）

不做：後端、帳號、雲端同步、LLM API 對話、真人音檔、多使用者、成就系統、社群功能。
自由對話式口說不在 App 內，用 `SPEAKING.md` 的場景在 Claude Project 語音練。
