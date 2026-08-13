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
npm run icons      # 重新產生 icons/（改圖案時才需要）
node scripts/smoke.mjs   # 無頭瀏覽器煙霧測試（需 puppeteer，選用）
```

> ES modules 與 fetch 不能用 `file://` 開，一定要走 http。

## 目前進度

- **M1 完成**：Shell/路由/首頁、單字 SRS、閱讀、進度＋匯出匯入、TTS、設定、PWA、內容 vocab 100 ＋ readings 10
- **M2 未開始**：跟讀評分（`js/scoring.js`）、Email 句型、簡報句型、聽力。路由已佔位在 `js/views/soon.js`

## 邊界（附錄 B）

不做：後端、帳號、雲端同步、LLM API 對話、真人音檔、多使用者、成就系統、社群功能。
自由對話式口說不在 App 內，用 `SPEAKING.md` 的場景在 Claude Project 語音練。
