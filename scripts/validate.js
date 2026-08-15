// validate.js — 驗證 content/*.json 是否符合 SPEC.md 第 3 節的 schema
// 用法：node scripts/validate.js         （commit 前必跑）
//      node scripts/validate.js vocab   （只驗一個檔）

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDictation, extractNumbers, normalize } from '../js/scoring.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

/* ------------------------------ 小工具 ------------------------------ */

const errors = [];
const warnings = [];
let ctx = '';

const str = v => typeof v === 'string' && v.trim().length > 0;
const bad = msg => errors.push(`${ctx} ${msg}`);
const warn = msg => warnings.push(`${ctx} ${msg}`);

function req(obj, key, test, desc) {
  if (!test(obj[key])) bad(`欄位 ${key} ${desc}（目前：${JSON.stringify(obj[key])}）`);
}

function optional(obj, key, test, desc) {
  if (obj[key] !== undefined && !test(obj[key])) bad(`欄位 ${key} ${desc}`);
}

function oneOf(list) {
  return v => list.includes(v);
}

function checkQuestions(item) {
  if (!Array.isArray(item.questions)) return;
  item.questions.forEach((q, i) => {
    const tag = `questions[${i}]`;
    if (!str(q.q)) bad(`${tag}.q 必須是非空字串`);
    if (!Array.isArray(q.options) || q.options.length < 2) bad(`${tag}.options 至少 2 個選項`);
    else {
      if (q.options.length !== 4) warn(`${tag}.options 有 ${q.options.length} 個（慣例是 4 個）`);
      if (!q.options.every(str)) bad(`${tag}.options 有空白選項`);
      if (new Set(q.options).size !== q.options.length) bad(`${tag}.options 有重複選項`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options?.length ?? 0))
      bad(`${tag}.answer 必須是 0..${(q.options?.length ?? 1) - 1} 的整數（目前：${q.answer}）`);
    if (!str(q.explain_zh)) bad(`${tag}.explain_zh 必須是非空字串`);
  });
}

/* ------------------------------ Schemas ------------------------------ */

const SCHEMAS = {
  vocab: {
    idPrefix: 'v',
    target: { M1: 100, M2: 300, M3: 600 },
    check(it) {
      req(it, 'tier', oneOf(['A', 'B', 'C']), '必須是 A / B / C');
      req(it, 'term', str, '必須是非空字串');
      req(it, 'pos', str, '必須是非空字串（如 n. / v. / adj. / phr.）');
      req(it, 'zh', str, '必須是非空字串');
      req(it, 'def_en', str, '必須是非空字串');
      req(it, 'example', str, '必須是非空字串');
      req(it, 'example_zh', str, '必須是非空字串');
      req(it, 'tags', v => Array.isArray(v) && v.length > 0 && v.every(str), '必須是非空字串陣列');
      if (str(it.example) && str(it.term)) {
        // C 層是片語，動詞常變化（come up with → came up with），只要求多數字詞出現
        const words = it.term.toLowerCase().split(/\s+/);
        const ex = it.example.toLowerCase();
        const hit = words.filter(w => ex.includes(w)).length;
        const need = it.tier === 'C' ? Math.ceil(words.length / 2) : 1;
        if (hit < need) warn(`example 沒出現 term「${it.term}」`);
      }
      if (str(it.example) && it.example.split(/\s+/).length > 30) warn('example 超過 30 字，偏長');
    },
  },

  readings: {
    idPrefix: 'r',
    target: { M1: 10, M2: 20, M3: 30 },
    check(it) {
      req(it, 'level', v => [1, 2, 3].includes(v), '必須是 1 / 2 / 3');
      req(it, 'genre', oneOf(['customer_email', '8d_report', 'fa_report', 'trial_run_summary', 'spec_change_notice', 'audit_reply']), '不在枚舉內');
      req(it, 'title', str, '必須是非空字串');
      req(it, 'body', str, '必須是非空字串');
      req(it, 'body_zh', str, '必須是非空字串');
      req(it, 'glossary', v => Array.isArray(v), '必須是陣列');
      (it.glossary || []).forEach((g, i) => {
        if (!str(g.term) || !str(g.zh)) bad(`glossary[${i}] 需要 term 與 zh`);
        // 與前端 glossify() 一致：允許複數形
        else if (str(it.body) && !new RegExp(`\\b${g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${/[A-Za-z]$/.test(g.term) ? 's?' : ''}\\b`, 'i').test(it.body))
          warn(`glossary「${g.term}」在 body 裡找不到，前端不會加底線`);
      });
      req(it, 'key_patterns', v => Array.isArray(v) && v.length > 0, '至少一組');
      (it.key_patterns || []).forEach((k, i) => {
        if (!str(k.en) || !str(k.zh)) bad(`key_patterns[${i}] 需要 en 與 zh`);
      });
      req(it, 'questions', v => Array.isArray(v) && v.length >= 2, '至少 2 題');
      checkQuestions(it);
    },
  },

  email_patterns: {
    idPrefix: 'e',
    target: { M2: 30 },
    check(it) {
      req(it, 'scenario', oneOf(['bad_news', 'request_extension', 'status_update', 'rca_summary', 'reply_complaint', 'request_waiver']), '不在枚舉內');
      req(it, 'scenario_zh', str, '必須是非空字串');
      req(it, 'pattern', str, '必須是非空字串');
      req(it, 'pattern_zh', str, '必須是非空字串');
      req(it, 'filled_example', str, '必須是非空字串');
      req(it, 'cloze', v => v && str(v.text) && Array.isArray(v.answers) && v.answers.every(str), '需要 {text, answers[]}');
      if (it.cloze && str(it.cloze.text) && Array.isArray(it.cloze.answers)) {
        const blanks = (it.cloze.text.match(/_{2,}/g) || []).length;
        if (blanks !== it.cloze.answers.length)
          bad(`cloze 空格數 ${blanks} 與 answers 數量 ${it.cloze.answers.length} 不一致`);
      }
      req(it, 'dont', v => v && str(v.en) && str(v.why_zh), '需要 {en, why_zh}');
    },
  },

  presentation: {
    idPrefix: 'p',
    target: { M2: 40 },
    check(it) {
      req(it, 'section', oneOf(['opening', 'agenda', 'data_description', 'root_cause', 'action', 'qa_defense', 'closing']), '不在枚舉內');
      req(it, 'section_zh', str, '必須是非空字串');
      req(it, 'en', str, '必須是非空字串');
      req(it, 'zh', str, '必須是非空字串');
      req(it, 'shadow', v => typeof v === 'boolean', '必須是 boolean');
    },
  },

  listening: {
    idPrefix: 'l',
    target: { M2: 8, M3: 15 },
    check(it) {
      req(it, 'title', str, '必須是非空字串');
      req(it, 'turns', v => Array.isArray(v) && v.length >= 2, '至少 2 個 turn');
      (it.turns || []).forEach((t, i) => {
        if (!str(t.speaker) || !str(t.text)) bad(`turns[${i}] 需要 speaker 與 text`);
        if (!/^en[-_][A-Za-z]{2}$/.test(t.voice || '')) bad(`turns[${i}].voice 必須是 en-XX（如 en-US / en-GB）`);
      });
      req(it, 'questions', v => Array.isArray(v) && v.length >= 1, '至少 1 題');
      checkQuestions(it);
      req(it, 'dictation', v => Array.isArray(v) && v.length >= 1, '至少 1 題聽寫');
      (it.dictation || []).forEach((d, i) => {
        if (!str(d.text) || !str(d.answer_display)) bad(`dictation[${i}] 需要 text 與 answer_display`);
        if (!['numbers', 'workweek', 'spec', 'percentage'].includes(d.focus)) bad(`dictation[${i}].focus 不在枚舉內`);
        if (str(d.text) && str(d.answer_display)) {
          // 題目一定要能被 scoring.checkDictation 判對，否則使用者照著答案打也會被判錯
          const expected = extractNumbers(normalize(d.text));
          if (!expected.length) bad(`dictation[${i}].text 抽不到任何數字，聽寫題必須考數字`);
          else if (!checkDictation(d.text, d.answer_display).pass) {
            bad(`dictation[${i}] 的 answer_display「${d.answer_display}」判不過；text 抽到 [${expected}]，answer 抽到 [${extractNumbers(normalize(d.answer_display))}]`);
          }
        }
      });
    },
  },

  interview: {
    idPrefix: 'i',
    target: { M4: 40, M6: 67 },
    check(it) {
      req(it, 'category', oneOf(['self_intro', 'experience', 'technical', 'behavioral', 'motivation', 'salary_logistics', 'ask_them']), '不在枚舉內');
      req(it, 'category_zh', str, '必須是非空字串');
      req(it, 'q', str, '必須是非空字串');
      req(it, 'q_zh', str, '必須是非空字串');
      req(it, 'intent_zh', str, '必須是非空字串');
      req(it, 'outline_zh', v => Array.isArray(v) && v.length >= 2 && v.every(str), '至少 2 個回答骨架步驟');
      req(it, 'answer', str, '必須是非空字串');
      req(it, 'answer_zh', str, '必須是非空字串');
      req(it, 'core', str, '必須是非空字串');
      req(it, 'key_phrases', v => Array.isArray(v) && v.length > 0, '至少一組');
      (it.key_phrases || []).forEach((k, i) => {
        if (!str(k.en) || !str(k.zh)) bad(`key_phrases[${i}] 需要 en 與 zh`);
      });
      req(it, 'follow_ups', v => Array.isArray(v) && v.length > 0, '至少一個追問');
      (it.follow_ups || []).forEach((f, i) => {
        if (!str(f.en) || !str(f.zh)) bad(`follow_ups[${i}] 需要 en 與 zh`);
        if (f.tip_zh !== undefined && !str(f.tip_zh)) bad(`follow_ups[${i}].tip_zh 必須是非空字串`);
      });

      // 對話練習（M6，#/interview/talk）只抽這兩類，而且要一路追問下去，
      // 所以追問必須有三層、每層都要有回答方向；缺了就會出現「答完沒東西看」的空畫面。
      if (it.category === 'self_intro' || it.category === 'experience') {
        const fu = it.follow_ups || [];
        if (fu.length < 3) bad(`對話練習用的題目需要至少 3 個追問（目前 ${fu.length}）`);
        fu.forEach((f, i) => {
          if (!str(f.tip_zh)) bad(`follow_ups[${i}] 缺 tip_zh（對話練習要顯示回答方向）`);
        });
      }
      req(it, 'dont', v => v && str(v.en) && str(v.why_zh), '需要 {en, why_zh}');
      req(it, 'shadow', v => typeof v === 'boolean', '必須是 boolean');

      // core 必須是 answer 裡真的出現的句子，跟讀時才不會唸到範答裡沒有的句子（SPEC §3.6）
      if (str(it.answer) && str(it.core)) {
        const flat = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        if (!flat(it.answer).includes(flat(it.core))) bad('core 不是 answer 裡的句子（跟讀會對不上）');
        const n = it.core.split(/\s+/).length;
        if (n > 28) bad(`core 有 ${n} 字，超過 28 字；iOS 的 STT 停頓就結束，整段跟讀必定失敗`);
      }
      if (str(it.answer) && it.answer.split(/\s+/).length > 110) warn('answer 超過 110 字，面試範答偏長');
    },
  },
};

/* ------------------------------ 執行 ------------------------------ */

const only = process.argv[2];
const names = only ? [only] : Object.keys(SCHEMAS);

for (const name of names) {
  const schema = SCHEMAS[name];
  if (!schema) { console.error(`✗ 未知的內容檔：${name}`); process.exit(2); }

  const file = join(CONTENT, `${name}.json`);
  ctx = `[${name}]`;

  if (!existsSync(file)) {
    warn('檔案不存在（尚未產生內容）');
    continue;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    bad(`JSON 解析失敗：${err.message}`);
    continue;
  }

  if (data.version !== 1) bad(`頂層 version 應為 1（目前：${data.version}）`);
  if (!Array.isArray(data.items)) { bad('頂層缺少 items 陣列'); continue; }

  const seen = new Set();
  const idRe = new RegExp(`^${schema.idPrefix}\\d{3}$`);

  data.items.forEach((it, i) => {
    ctx = `[${name}#${it?.id || `index ${i}`}]`;
    if (!it || typeof it !== 'object') { bad('項目不是物件'); return; }
    if (!idRe.test(it.id || '')) bad(`id 格式應為 ${schema.idPrefix}001 這種三位數`);
    if (seen.has(it.id)) bad('id 重複');
    seen.add(it.id);
    schema.check(it);
  });

  ctx = `[${name}]`;
  const n = data.items.length;
  const milestones = Object.entries(schema.target || {})
    .map(([m, t]) => `${m}:${n >= t ? '✓' : `${n}/${t}`}`).join('  ');
  console.log(`${n.toString().padStart(4)} 筆  content/${name}.json   ${milestones}`);
}

/* ------------------------------ 報告 ------------------------------ */

console.log('');
for (const w of warnings) console.log(`⚠️  ${w}`);
for (const e of errors) console.log(`❌  ${e}`);

if (errors.length) {
  console.log(`\n驗證失敗：${errors.length} 個錯誤、${warnings.length} 個警告。`);
  process.exit(1);
}
console.log(`✅ 驗證通過（${warnings.length} 個警告）。`);
