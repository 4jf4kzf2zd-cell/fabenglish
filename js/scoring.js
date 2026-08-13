// scoring.js — 跟讀評分（token 對齊）與數字聽寫比對
// 純函式、不碰 DOM、不碰瀏覽器 API，所以可以直接用 node 跑單元測試：
//   node scripts/test-scoring.mjs

/* ------------------------------------------------------------------ */
/* 數字 ↔ 英文字                                                        */
/* ------------------------------------------------------------------ */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const WORD_ONES = Object.fromEntries(ONES.map((w, i) => [w, i]));
const WORD_TENS = Object.fromEntries(TENS.map((w, i) => [w, i * 10]).filter(([w]) => w));
const WORD_MULT = { hundred: 100, thousand: 1000, million: 1000000 };

// 口語裡的 0：oh / o（例如 "ninety two point oh five"）
WORD_ONES.oh = 0;
WORD_ONES.o = 0;

/** 整數轉英文字（0–999,999,999）。 */
function intToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t} ${ONES[r]}` : t;
  }
  for (const [unit, value] of [['million', 1000000], ['thousand', 1000], ['hundred', 100]]) {
    if (n >= value) {
      const head = intToWords(Math.floor(n / value));
      const rest = n % value;
      return rest ? `${head} ${unit} ${intToWords(rest)}` : `${head} ${unit}`;
    }
  }
  return String(n);
}

/**
 * 數字轉英文字。小數逐位唸：92.5 → "ninety two point five"。
 * @param {number|string} value
 */
export function numToWords(value) {
  const s = String(value);
  const neg = s.startsWith('-');
  const [intPart, decPart] = s.replace('-', '').split('.');
  const n = Number(intPart);
  if (!isFinite(n)) return s;

  let out = intToWords(n);
  if (decPart) out += ' point ' + [...decPart].map(d => ONES[Number(d)]).join(' ');
  return (neg ? 'minus ' : '') + out;
}

/**
 * 從一串 token 裡抽出所有數值（英文字與阿拉伯數字都吃）。
 * "the yield dropped from ninety two point five to eighty seven point one percent in work week thirty two"
 *   → [92.5, 87.1, 32]
 */
export function extractNumbers(tokens) {
  const out = [];
  let total = 0;        // 已乘過 thousand / million 的部分
  let current = 0;      // 正在累積的三位數
  let decimals = null;  // 進入 point 之後的小數位
  let has = false;      // 目前有沒有累積中的數字
  let usedOnes = false, usedTens = false;

  const flush = () => {
    if (has) {
      const base = total + current;
      out.push(decimals && decimals.length ? Number(`${base}.${decimals.join('')}`) : base);
    }
    total = current = 0;
    decimals = null;
    has = usedOnes = usedTens = false;
  };

  for (const raw of tokens) {
    const t = String(raw).toLowerCase();

    // 阿拉伯數字（含小數）直接收
    if (/^\d+(\.\d+)?$/.test(t)) { flush(); out.push(Number(t)); continue; }

    // point 之後只吃個位數字；遇到別的就結束這個數，但 token 本身要繼續往下判（可能是下一個數的開頭）
    if (decimals !== null) {
      if (t in WORD_ONES && WORD_ONES[t] < 10) { decimals.push(WORD_ONES[t]); continue; }
      flush();
    }

    if (t === 'point' && has) { decimals = []; continue; }

    if (t in WORD_ONES) {
      // "ninety two" 要併起來；"two two" 則是兩個獨立的數
      if (usedOnes || (WORD_ONES[t] >= 10 && usedTens)) flush();
      current += WORD_ONES[t];
      usedOnes = true; has = true;
      continue;
    }
    if (t in WORD_TENS) {
      if (usedTens || usedOnes) flush();
      current += WORD_TENS[t];
      usedTens = true; has = true;
      continue;
    }
    if (t === 'hundred') {
      current = (has ? current : 1) * 100;
      usedOnes = usedTens = false;      // 百位之後還能接 "sixty eight"
      has = true;
      continue;
    }
    if (t === 'thousand' || t === 'million') {
      total += (has ? (total ? current : current || 1) : 1) * WORD_MULT[t];
      current = 0;
      usedOnes = usedTens = false;
      has = true;
      continue;
    }
    if (t === 'and' && has) continue;   // "one hundred and five"

    flush();
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* 正規化                                                              */
/* ------------------------------------------------------------------ */

// 縮寫展開：兩邊都套同一份，才對得起來
const CONTRACTIONS = {
  "let's": 'let us', "we're": 'we are', "we've": 'we have', "we'll": 'we will',
  "it's": 'it is', "that's": 'that is', "there's": 'there is', "here's": 'here is',
  "i'm": 'i am', "i've": 'i have', "you're": 'you are', "they're": 'they are',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "won't": 'will not',
  "can't": 'cannot', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
  "weren't": 'were not', "hasn't": 'has not', "haven't": 'have not', "couldn't": 'could not',
  "wouldn't": 'would not', "shouldn't": 'should not', "we'd": 'we would', "it'll": 'it will',
};

// 廠內縮寫的唸法（STT 聽到的是唸出來的字）
const SPOKEN = {
  ww: 'work week',
  pct: 'percent',
  vs: 'versus',
  etc: 'et cetera',
};

/** 字串 → 正規化 token 陣列（小寫、去標點、數字轉英文字）。 */
export function normalize(text) {
  let s = String(text || '').toLowerCase();

  // 排版符號 → 一般符號
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, ' ');

  // 縮寫展開（含前後界線）
  s = s.replace(/[a-z]+'[a-z]+/g, m => CONTRACTIONS[m] ?? m.replace("'", ''));

  // 符號 → 字
  s = s.replace(/%/g, ' percent ').replace(/&/g, ' and ').replace(/\+/g, ' plus ');
  s = s.replace(/(\d)\s*[-–]\s*(\d)/g, '$1 to $2');     // 3,000-cycle 之類

  // 數字與英文字黏在一起要拆開（ww32 → ww 32，168-hour → 168 hour）
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');

  // 千分位逗號
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');   // 千分位，1,000,000 這種連續兩組也要吃掉

  const raw = s.match(/[a-z]+|\d+(?:\.\d+)?/g) || [];

  const out = [];
  for (const tok of raw) {
    if (/^\d/.test(tok)) { out.push(...numToWords(tok).split(' ')); continue; }
    if (tok in SPOKEN) { out.push(...SPOKEN[tok].split(' ')); continue; }
    out.push(tok);
  }
  return out;
}

/**
 * 把目標句切成「可顯示的字」＋各自的正規化 token，之後才能逐字上色。
 * @returns {{words:{display:string, norm:string[]}[], tokens:string[]}}
 */
export function prepareTarget(text) {
  const words = String(text).split(/\s+/).filter(Boolean)
    .map(display => ({ display, norm: normalize(display) }));
  return { words, tokens: words.flatMap(w => w.norm) };
}

/* ------------------------------------------------------------------ */
/* LCS 對齊                                                            */
/* ------------------------------------------------------------------ */

/**
 * 目標與辨識結果做 token 級最長共同子序列。
 * @returns {{hits:boolean[], saidHits:boolean[], matched:number}}
 */
export function align(target, said) {
  const n = target.length, m = said.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = target[i] === said[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hits = new Array(n).fill(false);
  const saidHits = new Array(m).fill(false);
  let i = 0, j = 0, matched = 0;
  while (i < n && j < m) {
    if (target[i] === said[j]) { hits[i] = saidHits[j] = true; matched++; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { hits, saidHits, matched };
}

/**
 * 跟讀評分。
 * @param {string} targetText 目標句
 * @param {string} transcript STT 辨識結果
 * @returns {{score:number, words:{display:string, hit:boolean, empty:boolean}[], extra:string[], matched:number, total:number}}
 */
export function scoreShadow(targetText, transcript) {
  const { words, tokens } = prepareTarget(targetText);
  const said = normalize(transcript);
  const { hits, saidHits, matched } = align(tokens, said);

  // token 命中結果攤回每個顯示字
  let idx = 0;
  const outWords = words.map(w => {
    const span = hits.slice(idx, idx + w.norm.length);
    idx += w.norm.length;
    return {
      display: w.display,
      empty: w.norm.length === 0,                    // 純標點
      hit: w.norm.length === 0 || span.every(Boolean),
    };
  });

  const extra = said.filter((_, k) => !saidHits[k]);
  const total = tokens.length;
  return {
    score: total ? Math.round(matched / total * 100) : 0,
    words: outWords,
    extra,
    matched,
    total,
  };
}

/** 分數分級：≥80 綠、60–79 黃、<60 紅。 */
export function grade(score) {
  if (score >= 80) return 'good';
  if (score >= 60) return 'ok';
  return 'bad';
}

/* ------------------------------------------------------------------ */
/* 聽寫比對（只考數字、週次、規格值）                                    */
/* ------------------------------------------------------------------ */

/**
 * 比對聽寫答案：抽出數字序列比對，不要求整句。
 * 目標句是英文字（"ninety two point five"），使用者可以打 "92.5" 或英文字。
 * @returns {{pass:boolean, expected:number[], got:number[], missing:number[]}}
 */
export function checkDictation(targetText, userInput) {
  const expected = extractNumbers(normalizeForNumbers(targetText));
  const got = extractNumbers(normalizeForNumbers(userInput));

  const pool = [...got];
  const missing = [];
  for (const e of expected) {
    const at = pool.findIndex(g => Math.abs(g - e) < 1e-9);
    if (at === -1) missing.push(e);
    else pool.splice(at, 1);
  }
  return { pass: missing.length === 0 && expected.length > 0, expected, got, missing };
}

/** 給數字抽取用的 token 化：保留阿拉伯數字，不要轉成英文字。 */
function normalizeForNumbers(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[‘’]/g, "'").replace(/[–—]/g, ' ');
  s = s.replace(/%/g, ' percent ');
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');   // 千分位，1,000,000 這種連續兩組也要吃掉
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
  return s.match(/[a-z]+|\d+(?:\.\d+)?/g) || [];
}
