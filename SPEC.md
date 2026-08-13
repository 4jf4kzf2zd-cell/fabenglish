# FabEnglish — 商用英文練習 App 開發規格書

> 本文件是給 Claude Code 的完整開發規格。使用方式：建立新 repo，把本檔放在根目錄命名為 `SPEC.md`，
> 然後對 Claude Code 說：「請閱讀 SPEC.md，依 M1 里程碑的範圍開始實作，完成後跑一次驗收清單。」
> 建議同時建立 `CLAUDE.md`（附錄 C 有範本）讓 Claude Code 記住專案慣例。

---

## 0. 產品摘要

- **使用者**：台灣 NAND Flash 原廠工程師（yield analysis / device engineering 背景），英文程度 TOEIC 550–750。
- **目標**：每天 20–30 分鐘，強化工作場景英文——優先順序：① Email 與書面報告（8D/FA report）② 技術簡報 ③ 會議聽力。
- **範圍切分**：本 App 承載可獨自反覆練的模組（單字 SRS、閱讀、聽力、跟讀評分、進度追蹤）。
  自由對話式口說**不在本 App 範圍**（使用者在 Claude Project 內用語音與 Claude 練習）。
- **語言**：UI 使用繁體中文，學習內容為英文（附繁中翻譯）。

## 1. 技術棧（刻意保持簡單）

| 項目 | 決定 | 理由 |
|---|---|---|
| 前端 | **Vanilla HTML/CSS/JS（ES modules），無框架、無 build step** | 使用者正在學 web dev，要能看懂全部程式碼；GitHub Pages 直接部署 |
| 型態 | **PWA**（manifest.json + service worker） | 加到 iPhone 主畫面、離線可用（語音辨識除外） |
| 儲存 | **localStorage**（含匯出/匯入 JSON 備份） | iOS 可能回收 PWA 儲存空間，所以備份功能是必要的，不是加分項 |
| 語音 | **Web Speech API**：`speechSynthesis`（TTS）+ `webkitSpeechRecognition`（STT） | 免費、免 API key；iOS Safari 皆支援（STT 需網路） |
| 部署 | **GitHub Pages**（`https://` 為語音 API 必要條件） | 使用者已有 GitHub workflow 經驗 |
| 相依套件 | **零**。不引入任何 npm runtime 依賴 | 降低維護成本 |

**明確排除**（v1 不做）：使用者帳號/後端、LLM API 對話、真人錄音音檔、React/Vue、TypeScript、打包工具。

## 2. Repo 結構

```
fabenglish/
├── index.html            # 單一入口，SPA，hash routing（#/vocab, #/reading…）
├── manifest.json
├── sw.js                 # service worker：cache-first 靜態資源；content/*.json 用 stale-while-revalidate
├── css/app.css
├── js/
│   ├── app.js            # 路由 + 初始化
│   ├── store.js          # localStorage 讀寫、進度 schema、匯出/匯入
│   ├── srs.js            # Leitner 演算法 + 日期（含 dev 時間旅行；全 App 的「今天」都走 srs.today()）
│   ├── speech.js         # TTS / STT 封裝（所有 iOS workaround 集中在這裡）
│   ├── scoring.js        # 跟讀評分（token 對齊）＋數字聽寫比對；純函式，可用 node 測
│   ├── shadow.js         # 跟讀 UI 元件（單字例句／簡報句型／簡報模式共用）
│   ├── content.js        # content/*.json 載入與快取
│   ├── dom.js            # 極簡 DOM 建構工具（避免 innerHTML 拼字串）
│   └── views/            # 每個模組一個 view 檔（home / vocab / reading / email / present / listen / progress / settings）
├── content/
│   ├── vocab.json
│   ├── readings.json
│   ├── email_patterns.json
│   ├── presentation.json
│   └── listening.json
├── icons/                # PWA 圖示（由 scripts/make-icons.mjs 產生，勿手改）
├── scripts/
│   ├── validate.js       # node 腳本：驗證 content/*.json 符合 schema（commit 前必跑）
│   ├── test-scoring.mjs  # scoring.js 單元測試（純 node，無依賴）
│   ├── serve.mjs         # 本機靜態伺服器（ES modules 不能用 file:// 開）
│   ├── smoke.mjs         # 無頭瀏覽器煙霧測試（選用，需外部 puppeteer）
│   └── make-icons.mjs    # 產生 icons/（純 Node 手寫 PNG，零依賴）
├── package.json          # 只放 npm scripts 與 "type":"module"，dependencies 永遠是空的
├── SPEC.md
├── CLAUDE.md
├── README.md
└── SPEAKING.md           # 口說場景指令集（在 Claude Project 語音練，不屬於 App 功能）
```

> **view 的渲染契約**：`render(root, ctx)` 收到的 `root` 是 DocumentFragment，
> `render()` 回傳後內容會被搬進 `#view`，fragment 就空了。
> 之後才產生的內容（例如作答結果）必須寫進 render 期間先建好的容器，不可再 `root.append`。
> 附加子節點一律用 `dom.js` 的 `append()`，原生 `node.append(null)` 會把 `null` 印成文字。

## 3. 內容資料 Schema（`content/*.json`）

所有內容檔頂層都有 `{"version": 1, "items": [...]}`。id 規則：`v001`（vocab）、`r001`（reading）、`e001`（email）、`p001`（presentation）、`l001`（listening）。

### 3.1 vocab.json — 單字（目標 600 筆：A 層專業 200 / B 層商務 250 / C 層片語 150）

```json
{
  "id": "v001",
  "tier": "A",
  "term": "yield excursion",
  "pos": "n.",
  "zh": "良率異常事件",
  "def_en": "A sudden, abnormal drop in yield beyond the expected baseline.",
  "example": "We detected a yield excursion on lot A123 during wafer sort in WW32.",
  "example_zh": "我們在 WW32 的 wafer sort 發現批號 A123 出現良率異常。",
  "tags": ["yield", "quality"]
}
```

### 3.2 readings.json — 閱讀（目標 30 篇，難度 1–3 級各 10 篇）

```json
{
  "id": "r001",
  "level": 1,
  "genre": "customer_email",
  "title": "Customer inquiry on WW32 yield excursion",
  "body": "Dear Jerry,\n\nDuring incoming inspection we observed ... Could you share the containment plan and the estimated date for the 8D report?\n\nBest regards,\nMark",
  "body_zh": "（全文繁中翻譯）",
  "glossary": [{"term": "containment plan", "zh": "圍堵對策"}],
  "key_patterns": [
    {"en": "Could you share ... and the estimated date for ...?", "zh": "索取資料＋要求時程的標準句式", "note": "客戶這樣問代表在要 commitment，回信必須給日期"}
  ],
  "questions": [
    {"q": "What is the customer actually asking for?", "options": ["...", "...", "...", "..."], "answer": 2, "explain_zh": "..."}
  ]
}
```

`genre` 枚舉：`customer_email` / `8d_report` / `fa_report` / `trial_run_summary` / `spec_change_notice` / `audit_reply`。

### 3.3 email_patterns.json — Email 句型庫（目標 30 組）

```json
{
  "id": "e001",
  "scenario": "bad_news",
  "scenario_zh": "通報壞消息（excursion 通知）",
  "pattern": "We regret to inform you that {lot} exhibited {failure_mode} during {test_stage}. As immediate containment, we have {action}.",
  "pattern_zh": "很遺憾通知您⋯作為立即圍堵措施，我們已⋯",
  "filled_example": "We regret to inform you that lot A123 exhibited elevated read-disturb failures during MST. As immediate containment, we have put all sister lots on hold.",
  "cloze": {"text": "We ___ to inform you that lot A123 ___ elevated read-disturb failures...", "answers": ["regret", "exhibited"]},
  "dont": {"en": "We are sorry, the lot has problem.", "why_zh": "太口語且文法錯誤；壞消息通知要用固定句式顯得可控"}
}
```

`scenario` 枚舉：`bad_news` / `request_extension` / `status_update` / `rca_summary` / `reply_complaint` / `request_waiver`。

### 3.4 presentation.json — 簡報句型（目標 40 句）

```json
{
  "id": "p001",
  "section": "data_description",
  "section_zh": "圖表描述",
  "en": "Sort yield trended up by 2.3 points after the fix was implemented in WW32.",
  "zh": "修正措施在 WW32 導入後，sort yield 上升了 2.3 個百分點。",
  "shadow": true
}
```

`section` 枚舉：`opening` / `agenda` / `data_description` / `root_cause` / `action` / `qa_defense` / `closing`。`shadow: true` 的句子進入跟讀題庫。

### 3.5 listening.json — 聽力（目標 15 段對話 + 聽寫題）

```json
{
  "id": "l001",
  "title": "Con-call: customer asks about the excursion",
  "turns": [
    {"speaker": "Mark (Customer QE)", "voice": "en-US", "text": "Thanks for joining. Can you walk us through the failure signature first?"},
    {"speaker": "You (Engineer)", "voice": "en-GB", "text": "Sure. The failures are concentrated in two wafers, both from the same furnace batch."}
  ],
  "questions": [{"q": "...", "options": ["...","...","...","..."], "answer": 0, "explain_zh": "..."}],
  "dictation": [
    {"text": "The yield dropped from ninety-two point five to eighty-seven point one percent in work week thirty-two.", "answer_display": "92.5% → 87.1%, WW32", "focus": "numbers"}
  ]
}
```

`dictation.focus` 枚舉：`numbers` / `workweek` / `spec` / `percentage`——聽寫題**只考數字、週次、規格值**這類會議裡最不能聽錯的資訊。

## 4. 模組規格

### 4.0 Shell / 路由 / 首頁

- Hash routing：`#/home` `#/vocab` `#/reading` `#/email` `#/present` `#/listen` `#/progress` `#/settings`。底部 tab bar（手機優先）。
- 首頁 = 今日待辦：今日 SRS 到期字數、建議行程（週一單字+聽力、週三 email、週五跟讀⋯可硬編碼）、連續天數 streak。

### 4.1 單字 SRS（Leitner 5 盒）

- 盒間隔：box1=每天、box2=2天、box3=4天、box4=8天、box5=16天。答對升一盒，答錯回 box1。新字每日上限預設 10（可調）。
- 卡片流程：正面顯示 `term`（＋🔊 TTS 按鈕）→ 使用者自評「認得/不認得」→ 背面顯示中譯、英文定義、例句（🔊 可播）→ 例句提供「跟讀」按鈕（叫用 4.6 跟讀引擎）。
- 每日佇列 = 到期複習字 + 新字，複習優先。

### 4.2 閱讀

- 列表依 level/genre 篩選；文章頁：英文原文（glossary 字詞加底線，點擊彈出中譯）→ 理解題（單選，答後顯示解說）→ key patterns 卡片。
- 完成條件：答完所有題目。記錄每篇的答對率。

### 4.3 Email 句型

- 依 scenario 分組瀏覽；每組：pattern＋範例＋dont 對照。
- 練習模式：cloze 填空（比對忽略大小寫與前後空白）。
- 頁尾固定提示：「寫完整封信？把草稿貼到 Claude Project 讓 Claude 批改。」

### 4.4 簡報句型

- 依 section 分組；每句：🔊 播放、顯示中譯、`shadow:true` 者有「跟讀」按鈕。
- 「簡報模式」：依 opening→agenda→data→root_cause→action→closing 順序抽句組成一份 10 句的模擬簡報稿，逐句跟讀，最後顯示總分。

### 4.5 聽力

- 對話播放器：逐句 TTS，兩個 speaker 用不同 voice；語速三檔 0.8×/1.0×/1.2×（`utterance.rate`，iOS 上實測 0.8–1.2 之外會失真）；支援單句重播、顯示/隱藏字幕。
- 流程：先盲聽 → 答理解題 → 開字幕重聽 → 聽寫題。
- 聽寫題：播放 `text`，使用者輸入聽到的數字/週次（自由格式），比對規則：抽出數字序列比對（"92.5" 對 "ninety-two point five"），不要求整句。

### 4.6 跟讀評分引擎（`scoring.js` + `speech.js`）

- 流程：播放目標句 → 倒數 → 啟動 `webkitSpeechRecognition`（`lang='en-US'`, `continuous=false`, `interimResults=true`）→ 使用者跟讀 → 取最終 transcript。
- 正規化：小寫、去標點、數字統一轉英文字（實作一個 `numToWords`，反向比對也接受阿拉伯數字）。
- 對齊：目標句與 transcript 做 token 級 LCS（最長共同子序列）；分數 = matched/target_tokens × 100。
- 呈現：目標句逐字上色（綠=命中、紅=漏掉），另列出多說的字；≥80 綠、60–79 黃、<60 紅，附「再試一次」。
- 每句保留最佳分數，寫入進度。

### 4.7 進度與備份（`store.js`）

localStorage key：`fabenglish.v1`，單一 JSON：

```json
{
  "schemaVersion": 1,
  "srs": {"v001": {"box": 3, "due": "2026-08-15", "lapses": 1}},
  "readings": {"r001": {"done": true, "score": 0.75}},
  "cloze": {"e001": {"passed": true}},
  "shadow": {"p001": {"best": 86}},
  "listening": {"l001": {"quiz": 0.8, "dictation": 0.5}},
  "streak": {"current": 4, "best": 12, "lastDay": "2026-08-13"},
  "settings": {"newPerDay": 10, "voice": "auto", "rate": 1.0}
}
```

- 進度頁：streak、各盒單字數量長條、各模組完成度、**匯出 JSON**（下載檔案）與**匯入 JSON**（檔案選擇器，匯入前確認覆蓋）。
- 每次寫入 localStorage 前 try/catch，失敗時 banner 提醒使用者匯出備份。

### 4.8 設定

- TTS voice 選擇（列出裝置上的 `en-*` voices，預設 auto）、語速、每日新字量、清除進度（雙重確認）。

## 5. Web Speech API — iOS Safari 實作備忘（重要，全部集中在 `speech.js`）

1. **TTS 需要 user gesture 解鎖**：首次 `speechSynthesis.speak()` 必須發生在點擊事件的同步呼叫鏈內。App 啟動後第一次播放一律綁在按鈕上；可在首次點擊時 speak 一個空白 utterance 完成解鎖。
2. **voices 非同步載入**：`getVoices()` 可能回空陣列，要監聽 `voiceschanged` 並快取；選 voice 優先序：使用者設定 > `en-US` 本地 voice（如 Samantha）> 第一個 `en-*`。
3. **長文字會被 iOS 截斷**：utterance 依句切段（以 `.  ?  !` split），逐段 speak。
4. **speaking 卡死 workaround**：切換頁面或重播前先 `speechSynthesis.cancel()`。
5. **STT 是 `webkitSpeechRecognition`**（有前綴），iOS 14.5+；**需要 https 與網路**（audio 上傳 Apple 伺服器辨識）。離線時要偵測並顯示「跟讀功能需要網路」。
6. **STT 會提早自動結束**：iOS 上停頓 1–2 秒就觸發 `onend`。跟讀是單句短語音，`continuous=false` 剛好；在 `onend` 時若還沒拿到 final result 就用最後一次 interim。
7. **麥克風權限**：首次啟動 STT 會跳系統詢問；`onerror` 的 `not-allowed` 要顯示引導文案（設定 > Safari > 麥克風）。
8. **PWA 注意**：加到主畫面後的 standalone模式下 STT 在較舊 iOS 有 bug，若偵測失敗，提示使用者改用 Safari 分頁開啟練跟讀（功能偵測，不要 UA sniffing）。

## 6. UI 原則

- 手機優先（375px 基準），單手可操作，tab bar 在底部；桌面版置中 max-width 480px 即可。
- 繁中 UI、極簡風格；深色模式跟隨系統（`prefers-color-scheme`）。
- 不用任何 UI 框架；CSS custom properties 管理色彩。
- 所有按鈕都要有 loading/disabled 狀態（TTS/STT 是非同步的）。

## 7. 里程碑與驗收標準

### M1 — 可用版（先做這個）
範圍：Shell/路由/首頁、單字 SRS、閱讀、進度＋匯出匯入、TTS 播放（單字與例句）、設定。內容：vocab 100 筆、readings 10 篇（用附錄 A prompt 生成）。
驗收：
- [ ] iPhone Safari 開啟 GitHub Pages 網址，可加入主畫面，離線可開啟（除 STT 外）　←　**待實機驗（需先部署）**
- [x] 新字學習→隔日出現在複習佇列（可用「時間旅行」debug 按鈕驗證，僅 dev 模式顯示）　←　`scripts/smoke.mjs` [3] 自動驗證
- [x] 匯出 JSON → 清除進度 → 匯入 → 進度完整還原　←　`scripts/smoke.mjs` [5] 自動驗證
- [ ] TTS 在 iPhone 實機可發聲（含第一次點擊解鎖）　←　**待實機驗**（無頭環境沒有 voices，只驗到不 crash）
- [x] `scripts/validate.js` 通過所有內容檔　←　vocab 100 / readings 10，0 警告

### M2 — 完整模組
範圍：跟讀評分引擎、簡報句型（含簡報模式）、Email 句型（含 cloze）、聽力（含聽寫）。內容補至：vocab 300、readings 20、email 30、presentation 40、listening 8。
驗收：
- [ ] iPhone 實機跟讀一句可得分且逐字上色正確　←　**待實機驗**（無頭環境沒有 STT，只驗到流程與離線分支）
- [x] 聽寫「92.5%」用文字輸入可判對　←　`scripts/test-scoring.mjs` 與 smoke [8] 自動驗證；`validate.js` 另外強制每題 answer_display 都要判得過
- [x] 離線時跟讀顯示需網路提示而非壞掉　←　smoke [7] 用 offline 模式自動驗證

實際完成：vocab 300（A100/B125/C75）、readings 20、email 30、presentation 40、listening 8。

### M3 — 打磨
範圍：內容補滿（vocab 600、readings 30、listening 15）、streak 通知（PWA badge 或首頁提示）、弱點清單（SRS lapses 最多的字、跟讀分數最低的句）匯出成 markdown（可貼回 Claude Project 生成加強教材）。

## 8. 測試清單（每個里程碑都要在 iPhone 實機過一遍）

Safari 分頁 + 主畫面 PWA 兩種模式各測：TTS 首次播放、voices 載入、STT 權限流程、離線行為、localStorage 在無痕模式的 fallback（顯示警告即可）、直向/橫向。

---

## 附錄 A — 內容生成 Prompt（給 Claude Code 用）

生成內容時，逐檔執行以下 prompt（一次一檔，生成後跑 `scripts/validate.js`）：

> 你是 NAND Flash 原廠的資深工程師兼商用英文教師。請依 SPEC.md 第 3.x 節的 schema 生成 `content/____.json` 的 N 筆內容。
> 要求：(1) 全部使用 NAND flash 原廠真實工作情境：wafer sort、MST、trial run、yield excursion、8D、FA、qualification、客戶 QE 往來；
> (2) 英文難度對準 TOEIC 600–750，句長 ≤ 25 字；(3) 繁體中文翻譯要自然，不要翻譯腔；
> (4) 專有名詞（yield、lot、WW32、8D）在中文裡保留英文；(5) id 連號不重複；(6) 只輸出合法 JSON。

vocab 分三批生成（A 層專業字 → B 層商務字 → C 層片語）；readings 依 genre 每類至少 3 篇。

## 附錄 B — 不做的事（防止 scope creep）

後端、帳號、雲端同步、LLM API 對話（Phase 3 另議）、真人音檔、多使用者、成就系統、社群功能。Claude Code 若建議加這些，一律先拒絕。

## 附錄 C — CLAUDE.md 範本

```markdown
# FabEnglish
商用英文練習 PWA。規格見 SPEC.md（唯一真相來源，改規格先改 SPEC.md）。
- Vanilla JS ES modules，零依賴、零 build step；部署 GitHub Pages
- 所有 iOS 語音 workaround 只放 js/speech.js；內容只放 content/*.json，改 schema 要同步改 scripts/validate.js
- UI 繁體中文；學習內容英文＋繁中翻譯
- commit 前跑 node scripts/validate.js
- 完成每個功能後更新 SPEC.md 第 7 節的驗收 checkbox
```
