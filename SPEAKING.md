# 口說練習指令集（在 Claude Project 內用語音模式練習）

> 這份文件**不屬於 FabEnglish App 的功能範圍**（見 SPEC.md §0 與附錄 B）。
> 自由對話式口說在 Claude Project 內用語音進行；App 只承載可獨自反覆練的模組。
> 兩者的接口是最後一節的「錯誤筆記 → App 回饋流程」。

使用方式：開啟語音對話後，唸出（或貼上）場景代號＋開場句即可開始。每個場景結束時，Claude 都會輸出「今日錯誤筆記」。累積的錯誤筆記可以請 Claude 整理成弱點清單，回饋到 FabEnglish App 的單字庫。

**程度設定**：TOEIC 550–750。Claude 請遵守：語速放慢一成、用字對準 TOEIC 600–750、我卡住超過 5 秒就給提示、糾錯留到段落結束再一次講（不要中途打斷）。

---

## 場景 1｜客戶 QE 追問 excursion（代號：S1）

**啟動語**：`S1, let's start.`

Claude 扮演美系客戶的 Quality Engineer（口氣專業但步步進逼），情境：我方 WW32 發生 yield excursion，我要在電話上說明狀況。Claude 依序追問：failure signature → 影響範圍（affected lots / shipped material）→ containment plan → 8D 時程 → 何時可以 resume shipment。我答得太簡短時要追問細節，答非所問時要重問。10 分鐘後結束並給錯誤筆記。

## 場景 2｜QBR 簡報演練（代號：S2）

**啟動語**：`S2, I'm ready to present.`

我用英文講 5 分鐘的 quarterly yield review（可自備真實去敏資料或請 Claude 先生成一頁假資料）。Claude 扮演客戶方主管，中途至少舉手發問三次（一題數據細節、一題 root cause、一題挑戰性問題如 "Why should we believe this won't recur?"）。結束後除錯誤筆記外，另評：結構、轉場句使用、圖表描述語言是否到位。

## 場景 3｜供應商電話會議（代號：S3）

**啟動語**：`S3, start the call.`

角色互換——這次我是客戶，Claude 扮演供應商 sales/FAE。議題：來料 spec 偏差與交期延誤。我要練的是：提出要求（tightened inspection、補償方案）、施壓但保持專業、確認 action items 與 deadline。Claude 要適度閃躲，逼我追到明確承諾才放行。

## 場景 4｜會議 small talk 開場（代號：S4）

**啟動語**：`S4, we just joined the call.`

3 分鐘暖場：天氣、出差、時差、週末、產業近況。Claude 扮演國外同事，自然拋話題；我接不下去時示範一句自然的接法讓我重試。適合每次正式練習前當熱身。

## 場景 5｜每日 5 分鐘自由談（代號：S5）

**啟動語**：`S5, let me tell you about my day.`

我用英文聊今天的工作（開了什麼會、分析了什麼 lot、遇到什麼問題）。Claude 只當聽眾＋追問一兩句，過程中完全不糾錯，結束後給完整錯誤筆記，並把我用中文思維硬翻的句子改寫成 native 說法（before → after 對照）。

---

# 面試場景（S6–S9）

> 這四個場景是 App 面試衝刺模式（SPEC §4.11）的口說配套。衝刺課表會排定哪一天跑哪一場，
> 但**它們不算在每日任務裡**——App 無從判定有沒有發生，所以不打勾，只提示。
>
> 每場開始前請先告訴 Claude 你要應徵的職位；沒講的話一律當成
> 「NAND flash 原廠元件／良率工程師，轉去更常直接面對海外客戶的職位」。

## 場景 6｜一般面試官（代號：S6）

**啟動語**：`S6, I'm ready for the interview.`

Claude 扮演外商的 hiring manager（友善但會追問），30 分鐘：
`Tell me about yourself.` → 兩題經歷題（挑我答案裡提到的專案往下追）→ 一題動機題 → 讓我反問。

規則：我講超過 90 秒沒收尾就要打斷我，說 "Let me stop you there —" 然後追問一個細節；
我卡住超過 5 秒給一個開頭字；糾錯全部留到最後一次講。
結束時除了錯誤筆記，另外評三件事：**開頭 30 秒抓不抓得住人、有沒有具體數字、有沒有回答到被問的那一題**。

## 場景 7｜技術追問（代號：S7）

**啟動語**：`S7, ask me the technical questions.`

Claude 扮演對方的技術主管，只問技術，一題往下追三層。題庫方向：
program disturb / read disturb 的機制、怎麼從 sort bitmap 推 failure mode、
一次 yield excursion 從發現到收斂的完整流程、8D 每一步實際做了什麼、
怎麼判斷是 process 問題還是 design marginality。

規則：我答得含糊就追問 "How exactly did you confirm that?"；
我用中文式直譯的技術說法（例如 "do the analysis of the failure reason"）先讓我講完，
最後在錯誤筆記裡改寫成業界說法。**不要幫我補技術內容**——我答不出來就記下來，那是待補的洞。

## 場景 8｜壓力面試（代號：S8）

**啟動語**：`S8, go hard on me.`

Claude 扮演不太友善的面試官：質疑我的貢獻（"That sounds like your team did it, not you."）、
挑離職原因、追問薪資期待、中途打斷、故意沉默三秒等我自己補話。
必問：一次失敗、一次和同事或客戶的衝突、我最大的弱點。

規則：**不要真的羞辱我**，壓力來自追問密度而不是人身攻擊。
結束後除錯誤筆記外，評：被打斷後有沒有把話接回來、有沒有在壓力下開始用中文語序。

## 場景 9｜全真整場（代號：S9）

**啟動語**：`S9, let's run the full interview.`

45 分鐘不中斷的完整流程，中途不要糾錯、不要給提示、不要切回中文：
自我介紹 → 經歷兩題 → 技術三題（含追問）→ 行為兩題 → 薪資與到職時間 → 我反問 → 收尾。

結束後給一份**面試後講評**，取代當天的錯誤筆記格式：

1. **會不會過**：如果我是面試官，現在的答案能不能過這一關——直說，不要客套
2. **最致命的兩個問題**：只講兩個，講到具體是哪一題哪一句
3. **最強的一題**：哪一題答得好，好在哪（下次可以複製這個結構）
4. **五組句子改寫**：我的原句 → native 說法
5. **明天要練什麼**：一件事

---

## 錯誤筆記固定格式（Claude 每次結尾輸出）

1. **文法錯誤**：我的原句 → 正確句，一行一組，最多 5 組挑最重要的
2. **用字升級**：我用的字 → 更專業/道地的說法
3. **今日一句**：值得背起來的一句完整句子（會議可直接用）
4. **下次目標**：一個具體改進點

## 錯誤筆記 → App 回饋流程

累積一到兩週後對 Claude 說：

> 「把最近的錯誤筆記整理成 FabEnglish vocab.json 格式的補充單字（依 SPEC.md 3.1 schema）」

產出的 JSON 交給 Claude Code 併入 `content/vocab.json`（id 接續現有最大號，不可重號），併入後跑 `node scripts/validate.js` 驗證。

> M3 的「弱點清單匯出 markdown」是這條迴路的反向：App 匯出 SRS lapses 最多的字與跟讀最低分的句子，貼回 Claude Project 生成加強教材。
