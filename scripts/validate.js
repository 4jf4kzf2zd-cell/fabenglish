// validate.js — 驗證 content/*.json 是否符合 SPEC.md 第 3 節的 schema
// 用法：node scripts/validate.js         （commit 前必跑）
//      node scripts/validate.js vocab   （只驗一個檔）

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      });
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
