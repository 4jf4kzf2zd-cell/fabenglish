// test-scoring.mjs — scoring.js 單元測試（純函式，不需要瀏覽器）
// 用法：node scripts/test-scoring.mjs

import {
  numToWords, extractNumbers, normalize, scoreShadow, grade, checkDictation,
} from '../js/scoring.js';

let pass = 0;
const fails = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fails.push(`${name}\n      期待 ${e}\n      實際 ${a}`); }
}
function ok(name, cond, detail = '') {
  if (cond) pass++; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/* ---------- numToWords ---------- */
eq('numToWords 0', numToWords(0), 'zero');
eq('numToWords 13', numToWords(13), 'thirteen');
eq('numToWords 32', numToWords(32), 'thirty two');
eq('numToWords 87', numToWords(87), 'eighty seven');
eq('numToWords 100', numToWords(100), 'one hundred');
eq('numToWords 168', numToWords(168), 'one hundred sixty eight');
eq('numToWords 3000', numToWords(3000), 'three thousand');
eq('numToWords 1000000', numToWords(1000000), 'one million');
eq('numToWords 92.5', numToWords(92.5), 'ninety two point five');
eq('numToWords 2.3', numToWords('2.3'), 'two point three');
eq('numToWords 0.4', numToWords(0.4), 'zero point four');

/* ---------- normalize ---------- */
eq('normalize 大小寫與標點', normalize('Sort yield, please!'), ['sort', 'yield', 'please']);
eq('normalize 數字轉字', normalize('up by 2.3 points'), ['up', 'by', 'two', 'point', 'three', 'points']);
eq('normalize 百分比', normalize('87.1%'), ['eighty', 'seven', 'point', 'one', 'percent']);
eq('normalize WW32 唸成 work week', normalize('in WW32'), ['in', 'work', 'week', 'thirty', 'two']);
eq('normalize 縮寫展開', normalize("Let's start."), ['let', 'us', 'start']);
eq('normalize 8D 拆開', normalize('the 8D report'), ['the', 'eight', 'd', 'report']);
eq('normalize 千分位', normalize('3,000 cycles'), ['three', 'thousand', 'cycles']);
ok('normalize 空字串不炸', normalize('').length === 0);

// 阿拉伯數字與英文字要正規化成同一串（SPEC §4.6：反向比對也接受阿拉伯數字）
eq('數字兩種寫法等價',
  normalize('yield is 92.5 percent'),
  normalize('yield is ninety-two point five percent'));

/* ---------- extractNumbers ---------- */
eq('extractNumbers 英文字', extractNumbers(normalize('ninety two point five')), [92.5]);
eq('extractNumbers 多個數字',
  extractNumbers(normalize('The yield dropped from ninety-two point five to eighty-seven point one percent in work week thirty-two.')),
  [92.5, 87.1, 32]);
eq('extractNumbers 阿拉伯數字', extractNumbers(['92.5', 'percent']), [92.5]);
eq('extractNumbers 百位', extractNumbers(normalize('one hundred sixty eight hours')), [168]);
eq('extractNumbers 千位', extractNumbers(normalize('three thousand cycles')), [3000]);
eq('extractNumbers 沒有數字', extractNumbers(normalize('no numbers here')), []);

/* ---------- scoreShadow ---------- */
{
  const target = 'Sort yield trended up by 2.3 points after the fix was implemented in WW32.';

  const perfect = scoreShadow(target, 'sort yield trended up by two point three points after the fix was implemented in work week thirty two');
  eq('跟讀全對 = 100', perfect.score, 100);
  ok('跟讀全對時每個字都命中', perfect.words.every(w => w.hit));
  eq('跟讀全對時沒有多說的字', perfect.extra, []);

  const digits = scoreShadow(target, 'Sort yield trended up by 2.3 points after the fix was implemented in WW32');
  eq('用阿拉伯數字唸也算對', digits.score, 100);

  const partial = scoreShadow(target, 'sort yield trended up by two points after the fix in work week thirty two');
  ok('漏字會扣分', partial.score < 100 && partial.score > 50, `score=${partial.score}`);
  ok('漏掉的字標記為未命中', partial.words.some(w => !w.hit && !w.empty));

  const extra = scoreShadow('We regret to inform you.', 'we really regret to inform you today');
  eq('多說的字被列出', extra.extra, ['really', 'today']);
  eq('多說不影響目標命中率', extra.score, 100);

  const empty = scoreShadow(target, '');
  eq('沒說話 = 0 分', empty.score, 0);

  const nothing = scoreShadow('', 'anything');
  eq('空目標句不會除以零', nothing.score, 0);
}

/* ---------- grade ---------- */
eq('grade 80 → good', grade(86), 'good');
eq('grade 79 → ok', grade(79), 'ok');
eq('grade 59 → bad', grade(59), 'bad');

/* ---------- checkDictation ---------- */
{
  const t = 'The yield dropped from ninety-two point five to eighty-seven point one percent in work week thirty-two.';

  ok('聽寫：阿拉伯數字自由格式可判對', checkDictation(t, '92.5% → 87.1%, WW32').pass);
  ok('聽寫：純數字空白分隔可判對', checkDictation(t, '92.5 87.1 32').pass);
  ok('聽寫：用英文字回答也可判對', checkDictation(t, 'ninety two point five, eighty seven point one, thirty two').pass);
  ok('聽寫：少打一個數字不算過', !checkDictation(t, '92.5 87.1').pass);
  ok('聽寫：數字打錯不算過', !checkDictation(t, '92.5 87.2 32').pass);
  ok('聽寫：多打數字仍算過（只要目標數字都在）', checkDictation(t, '92.5 87.1 32 2026').pass);

  const spec = checkDictation('The bake is one hundred twenty five degrees for one hundred sixty eight hours.', '125°C 168hr');
  ok('聽寫：規格值可判對', spec.pass, JSON.stringify(spec));

  eq('聽寫：missing 會列出漏掉的數字', checkDictation(t, '92.5').missing, [87.1, 32]);
  ok('聽寫：目標沒有數字時不算過', !checkDictation('no numbers', '123').pass);
}

/* ---------- 報告 ---------- */
console.log('');
for (const f of fails) console.log(`❌  ${f}`);
if (fails.length) {
  console.log(`\nscoring.js：${pass} 通過，${fails.length} 失敗。`);
  process.exit(1);
}
console.log(`✅ scoring.js 全部 ${pass} 項通過。`);
