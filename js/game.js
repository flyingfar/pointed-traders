// Game rules — shared by host (who scores) and player (who previews payoffs).
//
//  • Each player splits a points budget (default 100) across the N question categories
//    before seeing any question. Every category gets between minPer and maxPer points
//    (default 5–30); the starting/default allocation is an even split (10 each).
//  • Every answer is symmetric: right = +stake × lever, wrong = −stake × lever.
//    By default there is no lever (×1). After reading a question the player may
//    play one of three one-shot levers — each usable once per game:
//        0.5× Hedge  → right: +½ stake     wrong: −½ stake
//        2×          → right: +2× stake    wrong: −2× stake
//        3×          → right: +3× stake    wrong: −3× stake
//  • Speed never matters — only accuracy and risk-taking.

import { at, toArr } from './util.js';

export const LEVERS = [
  { k: 0.5, key: 'h', short: '0.5×', name: 'Hedge' },
  { k: 1, key: 'x1', short: 'no lever', name: 'No lever' },
  { k: 2, key: 'x2', short: '2×', name: 'Lever' },
  { k: 3, key: 'x3', short: '3×', name: 'Max lever' },
];
/** The one-shot levers a player can actually pick (no 1× button — that's the default). */
export const PICKABLE = LEVERS.filter((l) => l.k !== 1);
export const levKey = (k) => (LEVERS.find((l) => l.k === k) || LEVERS[1]).key;
export const levShort = (k) => (LEVERS.find((l) => l.k === k) || LEVERS[1]).short;
// Each lever can be used once per game (fixed rule, not a per-quiz setting).
const LEVER_USES = { h: 1, x2: 1, x3: 1 };

// limits: -1 = unlimited
export const DEFAULT_SETTINGS = { budget: 100, timer: 30, step: 5, minPer: 5, maxPer: 30, limits: { ...LEVER_USES } };

export const withDefaults = (st) => ({ ...DEFAULT_SETTINGS, ...(st || {}), limits: { ...LEVER_USES } });

export function payoff(stake, lev, correct) {
  stake = Number(stake) || 0;
  if (!stake) return 0;
  return correct ? stake * lev : -stake * lev;
}

/** Even split of the budget, remainder going to the first categories (100 / 10 → 10 each). */
export function evenSplit(n, budget) {
  const base = Math.floor(budget / n);
  let rem = budget - base * n;
  return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0));
}

/** Problems with an allocation, or [] if it's valid (sums to budget, each within min–max). */
export function allocProblems(a, settings) {
  const st = withDefaults(settings);
  const out = [];
  const sum = a.reduce((s, v) => s + v, 0);
  if (sum !== st.budget) out.push(sum < st.budget ? `${st.budget - sum} points left` : `${sum - st.budget} over budget`);
  if (a.some((v) => v < st.minPer)) out.push(`min ${st.minPer} per category`);
  if (a.some((v) => v > st.maxPer)) out.push(`max ${st.maxPer} per category`);
  return out;
}

/** The allocation that actually counts: the player's own if valid, otherwise the default even split. */
export function allocFor(raw, n, settings) {
  const st = withDefaults(settings);
  if (raw) {
    const a = Array.from({ length: n }, (_, i) => Math.floor(Number(at(raw, i)) || 0));
    if (!allocProblems(a, st).length) return a;
  }
  return evenSplit(n, st.budget);
}

export function remainingLevers(settings, used) {
  settings = withDefaults(settings);
  const out = {};
  for (const l of LEVERS) {
    if (l.k === 1) { out[l.key] = Infinity; continue; }
    const lim = settings?.limits?.[l.key];
    out[l.key] = lim == null || lim < 0 ? Infinity : Math.max(0, lim - (used?.[l.key] || 0));
  }
  return out;
}

/** Recompute everyone's score from scratch for questions 0..upTo (deterministic, cheat-resistant). */
export function computeScores({ settings, questions, players, answers, upTo }) {
  settings = withDefaults(settings);
  const out = {};
  for (const [uid, p] of Object.entries(players || {})) {
    const alloc = allocFor(p.allocation, questions.length, settings);
    const used = { h: 0, x2: 0, x3: 0 };
    let total = 0, correct = 0;
    const deltas = [], levs = [], picks = [];
    for (let q = 0; q <= upTo; q++) {
      const a = at(at(answers, q), uid);
      let lev = 1, d = 0, pick = -1;
      if (a) {
        lev = [0.5, 1, 2, 3].includes(a.lev) ? a.lev : 1;
        const key = levKey(lev);
        const lim = settings.limits?.[key];
        if (lev !== 1 && lim != null && lim >= 0 && used[key] >= lim) lev = 1; // lever already used → no lever
        if (lev !== 1) used[levKey(lev)]++;
        pick = a.choice;
        const ok = a.choice === questions[q].correct;
        if (ok) correct++;
        d = payoff(alloc[q], lev, ok);
      }
      deltas.push(d); levs.push(lev); picks.push(pick);
      total += d;
    }
    out[uid] = { total, correct, deltas, levs, picks, used };
  }
  return out;
}

/** Sorted leaderboard with competition ranking (ties share a rank). */
export function rankList(players, scores) {
  const rows = Object.entries(players || {}).map(([uid, p]) => {
    const s = scores?.[uid] || {};
    return { uid, name: p.name, total: s.total || 0, correct: s.correct || 0, deltas: toArr(s.deltas), levs: toArr(s.levs) };
  });
  rows.sort((a, b) => b.total - a.total || b.correct - a.correct || String(a.name).localeCompare(b.name));
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.total === rows[i - 1].total && r.correct === rows[i - 1].correct ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

export function quizIssues(quiz) {
  const issues = [];
  const qs = toArr(quiz?.questions);
  const st = withDefaults(quiz?.settings);
  if (!quiz?.title?.trim()) issues.push('Missing title');
  if (!qs.length) issues.push('No questions');
  if (st.minPer > st.maxPer) issues.push('Min per category is above max');
  else if (qs.length && (st.minPer * qs.length > st.budget || st.maxPer * qs.length < st.budget))
    issues.push(`Budget ${st.budget} can't be split ${st.minPer}–${st.maxPer} across ${qs.length} categories`);
  qs.forEach((q, i) => {
    const opts = toArr(q.options);
    const filled = opts.filter((o) => String(o || '').trim());
    if (!String(q.category || '').trim()) issues.push(`Q${i + 1}: category`);
    if (!String(q.text || '').trim()) issues.push(`Q${i + 1}: question`);
    if (filled.length < 2 || filled.length !== opts.length) issues.push(`Q${i + 1}: options`);
    if (!(q.correct >= 0 && q.correct < opts.length)) issues.push(`Q${i + 1}: correct answer`);
  });
  return issues;
}

export function blankQuestion() {
  return { category: '', text: '', options: ['', '', '', ''], correct: -1, explanation: '', source: '' };
}

export const CATEGORY_SUGGESTIONS = [
  'Central Banks', 'Macro', 'Equities', 'Rates', 'FX', 'Commodities', 'Crypto', 'Earnings',
  'Deals & IPOs', 'Hong Kong', 'China', 'Asia', 'Tech', 'Policy', 'Derivatives', 'Wildcard',
];

export const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function sampleQuiz() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return {
    title: 'Sample week — market basics',
    weekOf: isoLocal(monday),
    settings: structuredClone(DEFAULT_SETTINGS),
    questions: [
      { category: 'Central Banks', text: 'Which body sets the US federal funds target rate?', options: ['US Treasury', 'FOMC', 'SEC', 'Congress'], correct: 1, explanation: 'The Federal Open Market Committee meets eight times a year to set the target range.' },
      { category: 'Hong Kong', text: 'The Hong Kong dollar is pegged to the US dollar within which band?', options: ['7.70 – 7.80', '7.75 – 7.85', '7.80 – 7.90', '7.85 – 7.95'], correct: 1, explanation: 'The Linked Exchange Rate System has kept HKD between 7.75 and 7.85 per USD since 2005.' },
      { category: 'Equities', text: "Which index is known as Wall Street's 'fear gauge'?", options: ['VIX', 'DXY', 'MOVE', 'NDX'], correct: 0, explanation: 'The Cboe VIX measures 30-day implied volatility of S&P 500 options.' },
      { category: 'Rates', text: 'When the yield curve "inverts", what has happened?', options: ['Long yields exceed short yields', 'Short-term yields exceed long-term yields', 'All yields turn negative', 'Real yields exceed nominal yields'], correct: 1, explanation: 'An inverted curve — e.g. 2y above 10y — has historically preceded recessions.' },
      { category: 'Commodities', text: 'Brent and WTI are benchmarks for which commodity?', options: ['Natural gas', 'Copper', 'Crude oil', 'Gold'], correct: 2, explanation: 'Brent (North Sea) and WTI (US) are the two main crude oil benchmarks.' },
      { category: 'Derivatives', text: 'Buying a put option gives you the right to…', options: ['Buy at the strike', 'Sell at the strike', 'Receive a fixed coupon', 'Defer settlement'], correct: 1, explanation: 'A put gives the holder the right, not the obligation, to sell the underlying at the strike.' },
      { category: 'Structured Products', text: 'In a Fixed Coupon Note, if the stock ends below the knock-in barrier, the investor typically…', options: ['Gets 100% cash back', 'Receives shares at the strike price', 'Gets a double coupon', 'The note is cancelled at par'], correct: 1, explanation: 'Below the KI the investor is effectively short a put — they take delivery of shares at the strike.' },
      { category: 'Macro', text: 'Which agency publishes the US nonfarm payrolls report?', options: ['Federal Reserve', 'Bureau of Labor Statistics', 'Census Bureau', 'Treasury'], correct: 1, explanation: 'The BLS releases the Employment Situation report, usually on the first Friday of the month.' },
      { category: 'Crypto', text: 'What is the maximum supply of Bitcoin?', options: ['18 million', '21 million', '100 million', 'Unlimited'], correct: 1, explanation: "Bitcoin's protocol caps supply at 21 million coins." },
      { category: 'Wildcard', text: 'Which exchange operator runs the Hang Seng Index futures market?', options: ['SGX', 'CME', 'HKEX', 'JPX'], correct: 2, explanation: 'HSI futures and options trade on Hong Kong Exchanges and Clearing (HKEX).' },
    ],
  };
}

export const AI_PROMPT = `You are writing a weekly markets news quiz for a university trading society.
Using the most important financial/market headlines from the past 7 days, write 10 multiple-choice questions.
Rules:
- Each question gets a short CATEGORY (1–3 words, e.g. "Central Banks", "Earnings", "Hong Kong", "Crypto"). Categories are shown to players BEFORE the questions, so they must not give the answer away.
- 4 options each, exactly one correct, plausible distractors.
- A one-sentence explanation with the key fact.
- Mix difficulty: 3 easy, 4 medium, 3 hard.
Return ONLY valid JSON in this exact shape:
{
  "title": "Week of <date>",
  "weekOf": "YYYY-MM-DD",
  "questions": [
    { "category": "...", "text": "...", "options": ["...","...","...","..."], "correct": 0, "explanation": "...", "source": "https://..." }
  ]
}
("correct" is the 0-based index of the right option.)`;
