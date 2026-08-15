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
│   ├── weakness.js       # 弱點清單 → markdown（M3）
│   ├── daily.js          # 每日任務：今天要做哪三件事、完成度（M5）
│   ├── plan.js           # 面試衝刺：42 天課表、倒數第幾天、每週里程碑（M6）
│   ├── wake.js           # 循環聽的背景播放嘗試：無聲音軌＋MediaSession＋wakeLock（M5）
│   ├── badge.js          # PWA 圖示未完成任務數（App Badging API，不支援時靜默）
│   ├── content.js        # content/*.json 載入與快取
│   ├── dom.js            # 極簡 DOM 建構工具（避免 innerHTML 拼字串）
│   └── views/            # 每個模組一個 view 檔（home / vocab / reading / email / present / listen / interview / loop / sprint / progress / settings）
├── content/
│   ├── vocab.json
│   ├── readings.json
│   ├── email_patterns.json
│   ├── presentation.json
│   ├── listening.json
│   └── interview.json    # 面試常見問題（M4）
├── icons/                # PWA 圖示（由 scripts/make-icons.mjs 產生，勿手改）
├── scripts/
│   ├── validate.js       # node 腳本：驗證 content/*.json 符合 schema（commit 前必跑）
│   ├── test-scoring.mjs  # scoring.js 單元測試（純 node，無依賴）
│   ├── test-daily.mjs    # daily.js / store.js 單元測試（純 node，無依賴）
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

所有內容檔頂層都有 `{"version": 1, "items": [...]}`。id 規則：`v001`（vocab）、`r001`（reading）、`e001`（email）、`p001`（presentation）、`l001`（listening）、`i001`（interview）。

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

### 3.6 interview.json — 面試常見問題（M4 目標 40 題；M6 補到 62 題）

```json
{
  "id": "i001",
  "category": "self_intro",
  "category_zh": "自我介紹",
  "q": "Tell me about yourself.",
  "q_zh": "請自我介紹。",
  "intent_zh": "面試官要的是 60 秒版本的「我是誰＋做過什麼＋為什麼坐在這裡」，不是履歷復誦。",
  "outline_zh": ["一句話定位：職稱＋年資＋領域", "一個可量化的代表作", "為什麼想要這個職位"],
  "answer": "I'm a device engineer with six years in NAND flash yield analysis. ...",
  "answer_zh": "（全文繁中翻譯）",
  "core": "I'm a device engineer with six years in NAND flash yield analysis.",
  "key_phrases": [{"en": "My main job is to ...", "zh": "我主要負責⋯"}],
  "follow_ups": [{"en": "What made you choose yield analysis?", "zh": "你為什麼選良率分析這條路？"}],
  "dont": {"en": "I was born in Taichung and I graduated in 2015...", "why_zh": "從出生講起會用掉全部時間，只講與這份工作有關的事。"},
  "shadow": true
}
```

`category` 枚舉：`self_intro` / `experience` / `technical` / `behavioral` / `motivation` / `salary_logistics` / `ask_them`。

- `answer` 是完整範答（60–90 字，逐句 ≤ 25 字），供閱讀與整段 TTS。
- **`core` 必須是 `answer` 裡實際出現的一個句子**且 ≤ 28 字——跟讀引擎只吃單句
  （SPEC §5-6：iOS 的 STT 停頓 1–2 秒就結束，整段跟讀必失敗）。`validate.js` 會強制檢查。

## 4. 模組規格

### 4.0 Shell / 路由 / 首頁

- Hash routing：`#/home` `#/vocab` `#/reading` `#/email` `#/present` `#/listen` `#/interview` `#/loop` `#/progress` `#/settings`。底部 tab bar（手機優先）。
- 首頁 = **今日任務**（M5 起，見 §4.10）：三項任務、完成度、連續天數、最近 14 天、模組入口。

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
- 四個步驟之間可以**回上一步**（已答的選項與聽寫結果保留）。

#### 4.5.1 循環聽（`#/loop`）

把常用句一直重複播放，通勤或做別的事時開著洗耳朵。只用 TTS，離線也能跑。

- 句源可切換：簡報句型 / Email 常用句 / 面試關鍵句（`key_phrases` ＋ `core`）/ 單字例句（優先只放學過的字）/ 全部混合。
- 參數：每句重複 1–3 次、句間停頓 0–3 秒、顯示或隱藏中文、照順序或隨機；重複次數與停頓存進 settings。
- 控制：▶/⏸、⏮ 上一句、⏭ 下一句；播到最後一句自動回到第一句，直到手動停止。
- 有 `navigator.wakeLock` 就用，沒有就算了。

**背景播放（M5，`js/wake.js`）**：`speechSynthesis` 在 iOS 被隱藏時會暫停，Safari 沒有正式支援網頁背景朗讀。
`wake.js` 用兩個手段拉高成功率，但**不保證**：

1. 播一段程式產生的幾乎無聲循環音軌（8-bit / 8kHz / 振幅 1 LSB 的 WAV，data URI，不是外部檔案），
   讓 iOS 把這個頁面當成「正在播放音訊」，audio session 才不會被收掉。
2. 掛 `navigator.mediaSession`：鎖定畫面與控制中心會出現播放／上一句／下一句控制。

設定 `loopBackground`（預設開）可以關掉。回到前景時若偵測到 `playing && !speech.speaking()`，
視為被系統中斷，顯示提示並從當前句接著播。
**若實機證明 iOS 不吃這套，唯一的替代方案是改放預先產生的音檔（`<audio>` 播放），
那會動到「零依賴」與 App 體積，屬於另一個里程碑，不要順手做。**

### 4.6 跟讀評分引擎（`scoring.js` + `speech.js`）

- 流程：倒數 → 啟動 `webkitSpeechRecognition`（`lang='en-US'`, `continuous=false`, `interimResults=true`）→ 使用者跟讀 → 取最終 transcript。
  **預設不先播範讀**（要聽的人自己按「🔊 聽一次」）；設定裡的 `playBeforeShadow` 打開才會先播再倒數。
- 正規化：小寫、去標點、數字統一轉英文字（實作一個 `numToWords`，反向比對也接受阿拉伯數字）。
- 對齊：目標句與 transcript 做 token 級 LCS（最長共同子序列）；分數 = matched/target_tokens × 100。
- 呈現：目標句逐字上色（綠＝命中、紅＝漏掉），另列出多說的字與辨識到的整句，附「再唸一次」。
- **不顯示分數**：Web Speech 對非母語腔調誤差過大，一個看似精確的數字會誤導使用者。
  分數仍在內部計算並保留最佳值（供「練過沒」與弱點清單排序用），但**任何 UI 都不得呈現數字或等第**。

### 4.7 進度與備份（`store.js`）

localStorage key：`fabenglish.v1`，單一 JSON：

```json
{
  "schemaVersion": 2,
  "srs": {"v001": {"box": 3, "due": "2026-08-15", "lapses": 1}},
  "readings": {"r001": {"done": true, "score": 0.75}},
  "cloze": {"e001": {"passed": true}},
  "shadow": {"p001": {"best": 86, "day": "2026-08-14"}},
  "listening": {"l001": {"quiz": 0.8, "dictation": 0.5}},
  "interview": {"i001": {"ok": true, "tries": 2, "day": "2026-08-14"}},
  "daily": {"2026-08-14": {"vocab": 10, "shadow": 8, "loopSec": 300}},
  "streak": {"current": 4, "best": 12, "lastDay": "2026-08-13"},
  "settings": {"newPerDay": 10, "voice": "auto", "rate": 1.0}
}
```

- 進度頁：streak、各盒單字數量長條、各模組完成度、**匯出 JSON**（下載檔案）與**匯入 JSON**（檔案選擇器，匯入前確認覆蓋）。
- 每次寫入 localStorage 前 try/catch，失敗時 banner 提醒使用者匯出備份。
- `daily`（M5）：每天做了多少，給 §4.10 判斷任務完成度用。**只留最近 60 天**，超過的在寫入時自動清掉。
- `migrate()` 會把舊備份（schema v1、沒有 `daily`）補齊欄位再吃進來，schema 只升不降。

**進度存在哪裡（常見誤解）**：進度**本來就只存在使用者這台裝置的瀏覽器**，不上傳、換手機不會跟著走。
真正的風險是 **iOS 會回收「7 天沒開過」的網站儲存空間**。M5 起：

- 設定頁有「儲存」卡片，說明存放位置、目前用量、是否已標記長期保存。
- 提供 `navigator.storage.persist()` 按鈕（Safari 不會跳詢問視窗，它自己依「有沒有加到主畫面」等訊號決定）。
- 沒有任何瀏覽器 API 保證不被清除 —— **定期匯出 JSON 仍然是唯一可靠的備份**，文案必須這樣寫，不要給假的安全感。

### 4.8 設定

- TTS voice 選擇（列出裝置上的 `en-*` voices，預設 auto）、語速、每日新字量、清除進度（雙重確認）。
- `playBeforeShadow`（預設 false）：跟讀前要不要先播一次範讀。
- `loopRepeat` / `loopGap`：循環聽的每句重複次數與句間停頓，由循環聽頁面直接寫入。
- `loopBackground`（預設 true，M5）：循環聽要不要嘗試在螢幕關閉後繼續播（見 §4.5.1）。由循環聽頁面直接寫入。
- 儲存卡片（M5）：進度存放位置說明、用量、長期保存要求按鈕（見 §4.7）。

### 4.9 面試常見問題

- 依 category 分組瀏覽；每題摺疊展開後依序顯示：**面試官在問什麼**（intent）→ **回答骨架**（outline）→
  範答（🔊 播整段）→ 核心句跟讀（叫用 4.6 引擎，只跟 `core` 單句）→ 關鍵句型 → 別這樣說 → 可能的追問。
- 預設收合，避免一眼看到答案；點「先自己答一次」會先播問題並隱藏範答。
- **模擬面試模式**（`#/interview/mock`）：依 self_intro→experience→technical→behavioral→motivation 抽 6 題，
  每題播問題 → 使用者出聲回答（App 不評分自由回答，SPEC §0 邊界）→ 自評「答得出來／卡住」→ 攤開範答並可跟讀核心句。
  最後顯示卡住的題目清單。自評結果寫進 `store.interview[id] = {ok: bool, tries: n}`。
- 頁尾固定提示：「想練完整對答？用 SPEAKING.md 的場景在 Claude Project 語音練。」

### 4.10 每日任務（M5，`js/daily.js`）

目的是讓使用者**每天都會打開**：首頁一進去就是「今天要做的三件事」，做完就結束，不要有無限清單。

- **一天固定三項**：第一項永遠是「清完今日單字」，另外兩項依星期輪替。
  總量對準 SPEC §0 的 20–30 分鐘，**不要加到四項**。

  | 星期 | 第二項 | 第三項 |
  |---|---|---|
  | 日 | 面試 3 題 | 循環聽 5 分鐘 |
  | 一 | 聽 1 段對話 | 循環聽 5 分鐘 |
  | 二 | 讀 1 篇文章 | 跟讀 5 句 |
  | 三 | Email 填空 2 組 | 循環聽 5 分鐘 |
  | 四 | 讀 1 篇文章 | 面試 2 題 |
  | 五 | 跟讀 8 句 | 聽 1 段對話 |
  | 六 | 聽 1 段對話 | 讀 1 篇文章 |

- **完成度自動判定，不手動打勾**。各模組完成時呼叫 `store.touchDay(today, yesterday, kind)`，
  kind ∈ `vocab / reading / cloze / shadow / listen / interview / loopSec`。
  **重做已完成的東西不重複計**（重讀舊文章、重唸同一句、同一題改自評都不加），
  否則「跟讀 5 句」按五次同一句就過了。
- **單字任務的目標＝今天已做 ＋ 現在還到期**。這樣邊做邊看目標不會縮水，也不必另外存「今天原本有幾張」。
  今天沒有到期單字時目標是 0，該項**直接算完成**（不能卡住整天）。
- 首頁：完成度 `n / 3`、進度條、逐項 ✓／`x / y`、一顆「繼續」直接跳到第一個未完成的模組、最近 14 天有沒有練。
- **PWA 圖示數字改成「今天還沒完成幾項」**（M4 以前是待複習卡數），做完就消失。
- 不做成就、獎章、獎勵（附錄 B）。streak 的定義不變：**有任何學習動作**就算，不要求做完三項。

### 4.11 面試衝刺模式（M6，`js/plan.js` + `#/sprint`）

有明確目標（通過一場英文面試）時，星期輪替就不夠用了——它沒有終點，也不會依「還剩幾天」調整強度。
衝刺模式把 §4.10 的排程換掉：**同樣一天三項、同樣自動判定**，但配課改成倒數 42 天的六個階段。

**啟動與倒數**

- `store.sprint = { start, target }`，`target` 預設 `start + 41`（六週）。使用者之後可以改成真正的面試日。
- **第幾天一律由終點反推**：`dayIndex = 42 - daysBetween(today, target)`，夾在 1–42。
  面試日比 42 天近時就從課表中段開始（前面的打底階段被跳過），這是刻意的——
  課表永遠對齊「面試前一天要在哪個狀態」，不是對齊「你哪天開始的」。
- `today > target` → 衝刺結束，自動回到星期輪替，並在首頁顯示一次結算。
- 衝刺沒啟動時 `plan.js` 完全不介入，§4.10 的行為一字不變。

**各主題同時進行，不是一個做完換下一個**

課表由「**一張每週都一樣的七天骨架**」×「每週參數」展開（`plan.js` 的 `PATTERN` 與 `WEEKS`）。
所以閱讀、聽力、Email、跟讀、循環聽、面試題、模擬面試**每一週都會輪到**；
變的只有面試題練哪一類、跟讀句數與循環聽分鐘數。這是結構保證，不是排表排出來的
（`test-daily.mjs` 會逐週檢查主題覆蓋率與每週 14 格）。

七天骨架（每格是當天的第二、三項；第一項永遠是單字）：

| 週內第幾天 | 第二項 | 第三項 |
|---|---|---|
| 1 | 面試 3 題（**從自我介紹開始**） | 跟讀 |
| 2 | 讀 1 篇文章 | 聽 1 段對話 |
| 3 | 面試 3 題 | Email 填空 2 組 |
| 4 | 循環聽 | 讀 1 篇文章 |
| 5 | 面試 3 題 | 聽 1 段對話 |
| 6 | **模擬面試 6 題** | 循環聽 |
| 7 | Email 填空 2 組 | 跟讀 |

一週 14 格 ＝ 面試題 3 ＋ 模擬面試 1 ＋ 閱讀 2 ＋ 聽力 2 ＋ Email 2 ＋ 跟讀 2 ＋ 循環聽 2。
單字（含例句跟讀）是第一項，每天都有。

每週參數與里程碑（`#/sprint` 顯示；里程碑不做自動判定）：

| 週 | 面試題焦點 | 跟讀 | 循環聽 | 模擬 | 週末前要生出來的東西 |
|---|---|---|---|---|---|
| 1 | 自我介紹與經歷 | 5 句 | 5 分 | 1 | 60 秒自我介紹的英文逐字稿定稿 ＋ 2 個經歷故事 |
| 2 | 動機與職涯 | 6 句 | 5 分 | 1 | 動機答案定稿 ＋ 3 個 STAR 故事的骨架 |
| 3 | 技術深挖 | 6 句 | 7 分 | 1 | 三條技術主線不看稿講 90 秒 |
| 4 | 行為題 STAR | 8 句 | 7 分 | 1 | 6 個 STAR 故事寫成完整句子 |
| 5 | 薪資、反問與加壓 | 8 句 | 7 分 | **2** | 薪資回答的一句話版本 ＋ 反問清單 5 題 |
| 6 | 收斂與減量 | 6 句 | 5 分 | 1 | 模擬面試 6 題全部「答得出來」且每題 60 秒內講完 |

- **自我介紹每週都滾一次**：每週第一個面試日的提示固定從自我介紹開始（`WEEKS[].ivOpen`），
  它不是第 1 週做完就結束的作業。
- 第 5 週把該週第 3 格的面試題換成第二場模擬面試（`extraMock`），主題覆蓋不變。
- **最後兩天（D41、D42）刻意減量**，用 `TAPER` 覆寫骨架：只重講自我介紹＋熱身。
  面試前一天塞新題目只會提高焦慮，對表現沒有幫助。第 6 週因此少一格 Email，是刻意的。

**語音模擬日（不是第四項任務）**

App 不做自由對話（附錄 B），所以真正的對答練習排在 `SPEAKING.md` 的面試場景，用 Claude 語音模式跑。
這些日子在首頁顯示成一條提示、在 `#/sprint` 列成清單，**但不進今日任務、不打勾、不影響完成度**——
因為 App 無從自動判定它有沒有發生，而 §4.10 的鐵則是「不手動打勾」。

| 天 | 場景 | 重點 |
|---|---|---|
| D7、D14 | S6 一般面試官 | 自我介紹＋經歷，練把準備好的答案講出來 |
| D21 | S7 技術追問 | 被連續追問技術細節不崩 |
| D28、D32 | S8 壓力面試 | 被質疑、被打斷、答不出來時怎麼接 |
| D35、D38、D40 | S9 全真整場 | 45 分鐘完整流程，含反問與薪資；最後一場刻意排在面試前兩天 |

**與每日任務的關係**

- 一天仍然**只有三項**（§4.10 的不變條件不因衝刺模式放寬）。
- 「模擬面試 6 題」用的還是 `interview` 這個 kind，只是任務把連結指到 `#/interview/mock` 並換掉提示文字；
  **不新增 kind、不新增 daily 欄位**，舊備份不受影響。
- 衝刺期間單字負擔會壓縮練面試的時間，`#/sprint` 會建議把「每日新字」調低（**只建議，不自動改設定**）。

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

驗收：
- [x] 內容補滿：vocab **600**（A200/B250/C150）、readings **30**（六種 genre、Lv1–3）、listening **15**　←　`validate.js` 0 警告
- [x] streak 通知：首頁到期提醒（`js/views/home.js`）＋ PWA 圖示待複習數（`js/badge.js`，App Badging API）　←　smoke [9] 自動驗證提醒卡片
- [x] 弱點清單匯出 markdown（`js/weakness.js`，進度頁可預覽／下載／複製）　←　smoke [9] 自動驗證
- [ ] iPhone 實機確認圖示數字會出現（需 iOS 16.4+、加到主畫面、允許通知）　←　**待實機驗**

> Badge 的限制：iOS 只有在「加到主畫面」後才支援，且需要通知權限；不支援時
> `js/badge.js` 全程靜默不報錯，設定頁會說明原因。

### M4 — 面試題、循環聽與跟讀改版
範圍：`content/interview.json` 40 題、`js/views/interview.js`（分類瀏覽＋模擬面試）、
`js/views/loop.js`（循環聽）、跟讀改為直接錄音且不顯示分數、各練習可回上一題。

驗收：
- [x] 40 題涵蓋七個 category，`validate.js` 通過（含 `core` 必須是 `answer` 的實際句子）　←　0 警告
- [x] 模擬面試抽 6 題、自評寫入進度、結束顯示卡住清單　←　smoke [10] 自動驗證
- [x] 弱點清單匯出的 markdown 含「面試答不出來的題目」段落　←　smoke [9] 自動驗證
- [x] 循環聽可連播、可換句源、重複次數與停頓生效　←　smoke [10] 驗到句源與換句（連播需真實 TTS）
- [x] 跟讀面板按下去直接進錄音（不先播範讀），且畫面上找不到任何分數　←　smoke [10] 驗證 UI 無分數
- [x] 單字、Email 填空、簡報模式、聽力、模擬面試都能回上一題　←　smoke [10] 驗證模擬面試往返
- [ ] iPhone 實機：循環聽連續播放不中斷、核心句跟讀可辨識　←　**待實機驗**

> 邊界提醒（附錄 B 仍然有效）：App **不評分自由回答**。模擬面試只播題目、計時、讓使用者自評，
> 真正的對答練習仍在 Claude Project 用語音做（`SPEAKING.md`）。

### M5 — 每日任務、儲存防護、背景播放
範圍：`js/daily.js`（每日任務）＋首頁改版、`store.js` schema v2（`daily` 每日紀錄、`persist()`）、
`js/wake.js`（循環聽背景播放嘗試）、badge 改成未完成任務數。

驗收：
- [x] 首頁一進去就是今日任務，固定三項、第一項是單字　←　`scripts/smoke.mjs` [12] 自動驗證
- [x] 完成任務後首頁完成度自動 +1，不需要手動打勾　←　smoke [12] 自動驗證
- [x] 重做已完成的東西不會重複計入（重讀舊文章／重唸同句／同題改自評）　←　`scripts/test-daily.mjs`
- [x] 今天沒有到期單字時單字任務自動完成，不會卡住整天　←　`test-daily.mjs` [4]
- [x] 每日紀錄只留 60 天，且匯出／匯入帶得走；舊 schema v1 備份匯入後自動補欄位　←　`test-daily.mjs` [15][16][17]
- [x] badge 數字＝今天還沒完成幾項，與首頁一致　←　smoke [12] 自動驗證
- [x] 設定頁說明進度存在哪裡、可要求長期保存　←　smoke [12] 自動驗證
- [x] 循環聽有「關螢幕繼續播」開關，切換會寫進設定　←　smoke [12] 自動驗證
- [ ] iPhone 實機：鎖屏後循環聽是否繼續播、鎖定畫面是否出現播放控制　←　**待實機驗**（見下方備註）
- [ ] iPhone 實機：加到主畫面後 7 天不開，進度是否還在　←　**待實機驗**（只能靠時間，無法自動化）

> **背景播放是「盡力而為」，不是保證**（§4.5.1）。實機測出來若鎖屏還是會停，
> 那是 iOS 的限制不是 bug；要真的做到必須改放預先產生的音檔，屬於另一個里程碑。
> 驗收時要分清楚三種結果：①完全繼續播 ②鎖定畫面有控制但朗讀會停 ③什麼都沒有。

### M6 — 面試衝刺模式
範圍：`js/plan.js`（42 天課表與倒數）、`store.js` schema v3（`sprint`）、`daily.js` 接管、
`js/views/sprint.js`（`#/sprint` 六週地圖）、首頁倒數與語音日提示、`SPEAKING.md` 面試場景 S6–S9、
`content/interview.json` 補題。

驗收：
- [x] 沒啟動衝刺時，每日任務與 M5 完全一樣（星期輪替）　←　`scripts/test-daily.mjs`
- [x] 啟動後首頁變成「倒數 N 天・第 M 天」，任務改吃課表　←　`test-daily.mjs`
- [x] 第幾天由終點反推：面試日提前時課表跟著往後跳，不會停在第 1 天　←　`test-daily.mjs`
- [x] 衝刺期間一天仍然只有三項，第一項仍是單字　←　`test-daily.mjs`
- [x] 模擬面試日的任務連到 `#/interview/mock`，且用的是既有的 `interview` kind　←　`test-daily.mjs`
- [x] 過了面試日自動結束衝刺並回到星期輪替　←　`test-daily.mjs`
- [x] `#/sprint` 顯示六週地圖、今天在哪一格、每週里程碑、語音模擬日　←　`scripts/smoke.mjs`
- [x] 語音模擬日只顯示提示，不進今日任務、不影響完成度　←　`test-daily.mjs`
- [x] **每一週都涵蓋全部主題**（面試／閱讀／聽力／Email／跟讀／循環聽），且每週至少一場模擬面試　←　`test-daily.mjs` [24]
- [x] 自我介紹每週都會被排到，不是只有第 1 週　←　`test-daily.mjs` [24]
- [x] 舊 schema v2 備份匯入後 `sprint` 為 null，不會壞　←　`test-daily.mjs`
- [ ] iPhone 實機：衝刺卡片與六週地圖在 390px 寬不破版　←　**待實機驗**

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
