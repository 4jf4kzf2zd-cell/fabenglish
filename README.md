# FabEnglish

NAND Flash 原廠工程師的商用英文練習 PWA。每天 20–30 分鐘，練 email、書面報告、技術簡報與會議聽力。

- **完整規格**：[SPEC.md](SPEC.md)（唯一真相來源）
- **開發慣例**：[CLAUDE.md](CLAUDE.md)
- **口說場景**（不在 App 內，用 Claude 語音練）：[SPEAKING.md](SPEAKING.md)

## 現況

| 里程碑 | 範圍 | 狀態 |
|---|---|---|
| M1 | Shell/路由/首頁、單字 SRS、閱讀、進度＋匯出匯入、TTS、設定、PWA | ✅ 已完成 |
| M2 | 跟讀評分、簡報句型（含簡報模式）、Email 句型（cloze）、聽力（含數字聽寫） | ✅ 已完成 |
| M3 | 內容補滿、streak 提示（首頁＋PWA 圖示數字）、弱點清單匯出 markdown | ✅ 已完成 |

內容現況：vocab **600**（A200/B250/C150）、readings **30**、email **30**、presentation **40**、listening **15**。

弱點清單：進度頁可把「記不住的單字、唸不好的句子、讀不懂的文章、聽不清楚的對話、寫不出來的句型」
整理成一份 Markdown 下載或複製，貼回 Claude Project 就能生成加強教材（檔尾附了現成的指令）。

## 本機開發

```bash
npm run serve      # → http://localhost:8080
npm run validate   # 驗證 content/*.json（commit 前必跑）
npm test           # scoring.js 單元測試（48 項）
```

> ES modules 與 `fetch` 不能用 `file://` 開，一定要走 http。
> `localhost` 會自動進入 dev 模式，首頁會出現「時間旅行」按鈕，用來驗證 SRS 隔日排程。

零 runtime 依賴、零 build step。`package.json` 只是用來放 npm scripts 與 `"type": "module"`。

## 測試

```bash
node scripts/validate.js                                   # 內容 schema（含聽寫題可判性）
node scripts/test-scoring.mjs                              # 48 項純函式單元測試
PUPPETEER_DIR=<有裝 puppeteer 的專案> node scripts/smoke.mjs   # 66 項無頭煙霧測試
```

煙霧測試涵蓋：SRS 升降盒與到期日、時間旅行後的隔日複習、匯出→清除→匯入完整還原、
閱讀作答、Email cloze 比對、跟讀面板與**離線降級**、聽力四階段與數字聽寫、
八條路由渲染、console 零錯誤。截圖輸出在 `.smoke/`。

`validate.js` 除了 schema，還會強制每一題聽寫的 `answer_display` 都能被 `scoring.checkDictation` 判對，
避免出現「照著答案打也被判錯」的題目。

**TTS 實際發聲、STT 跟讀評分、麥克風權限、PWA 加到主畫面、離線行為必須在 iPhone 實機驗**（SPEC §8）。

## 部署到 GitHub Pages

語音 API 需要 `https`，GitHub Pages 直接滿足。

```bash
git remote add origin git@github.com:<user>/fabenglish.git
git push -u origin master
```

GitHub → Settings → Pages → Source 選 `Deploy from a branch`，branch 選 `master`、資料夾 `/ (root)`。
專案是純靜態檔，不需要 Actions workflow。

網址會是 `https://<user>.github.io/fabenglish/`。所有路徑都用相對路徑寫，子目錄部署不會壞。

改版後若 iPhone 讀到舊快取，把 `sw.js` 裡的 `VERSION` 加一即可。

## 結構

```
index.html          單一入口（SPA + hash routing）
css/app.css         全部樣式，色彩用 CSS custom properties
js/app.js           路由與初始化
js/store.js         localStorage 唯一入口、匯出/匯入
js/srs.js           Leitner 5 盒與日期（含 dev 時間旅行）
js/speech.js        TTS/STT 封裝，所有 iOS workaround 都在這裡
js/scoring.js       跟讀 token 對齊評分 ＋ 數字聽寫比對（純函式）
js/shadow.js        跟讀 UI 元件（單字／簡報／簡報模式共用）
js/weakness.js      弱點清單 → markdown
js/badge.js         PWA 圖示待複習數（不支援時靜默）
js/content.js       content/*.json 載入與快取
js/dom.js           極簡 DOM 建構工具
js/views/           每個模組一個 view
content/*.json      學習內容
scripts/            validate / serve / smoke / make-icons
```
