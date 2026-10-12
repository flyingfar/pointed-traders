// QUICKFIRE mode — Kahoot-style: points for accuracy AND speed.
//
//  • No categories, no allocation, no levers. Players see the question and tap an answer —
//    one tap locks it in.
//  • Right answer: maxPoints × (1 − elapsed / timeLimit / 2), so an instant answer earns ~1000
//    and a correct answer on the buzzer still earns ~500. Wrong or no answer: 0.
//  • Elapsed time is measured on the database server (question start and answer arrival are
//    both server timestamps), so phone clocks and network jitter can't be gamed.

import { esc, fmt, signed, at, toArr, LETTERS } from '../util.js';

const DEFAULTS = { timer: 20, maxPoints: 1000 };
export const withDefaults = (st) => ({ ...DEFAULTS, ...(st || {}) });

/** Milliseconds a player took on question q, clamped to the time limit (null if unknown). */
export function elapsedMs(answer, started, timerSec) {
  if (!answer || typeof answer.at !== 'number' || typeof started !== 'number') return null;
  return Math.min(Math.max(0, answer.at - started), timerSec * 1000);
}

export function pointsFor(correct, ms, st) {
  if (!correct) return 0;
  const frac = ms == null ? 1 : ms / (st.timer * 1000);
  return Math.round(st.maxPoints * (1 - frac / 2));
}

export function computeScores({ settings, questions, players, answers, upTo, meta }) {
  const st = withDefaults(settings);
  const started = meta?.started || {};
  const out = {};
  for (const uid of Object.keys(players || {})) {
    let total = 0, correct = 0;
    const deltas = [], picks = [], times = [];
    for (let q = 0; q <= upTo; q++) {
      const a = at(at(answers, q), uid);
      const ms = elapsedMs(a, at(started, q), st.timer);
      const ok = !!a && a.choice === questions[q].correct;
      const d = pointsFor(ok, ms, st);
      if (ok) correct++;
      total += d;
      deltas.push(d);
      picks.push(a ? a.choice : -1);
      times.push(ms == null ? -1 : ms);
    }
    out[uid] = { total, correct, deltas, picks, times };
  }
  return out;
}

const secs = (ms) => (ms / 1000).toFixed(1) + 's';

// ------------------------------------------------------------------ phone (player) UI
function myElapsed({ S }) {
  return elapsedMs(S.myAnswer, at(S.meta.started, S.meta.qIndex), withDefaults(S.meta.settings).timer);
}

const playerLockedSummary = (ctx) => {
  const ms = myElapsed(ctx);
  return `<div class="card center"><div class="kicker">Answered in</div><div class="big-num" style="font-size:44px;margin-top:6px">${ms == null ? '…' : secs(ms)}</div></div>`;
};

const playerRevealLine = (ctx, s, q) => {
  const ms = at(s?.times, q);
  return ctx.S.myAnswer ? (ms != null && ms >= 0 ? `Answered in ${secs(ms)}` : 'Answered') : 'You missed this one';
};

function playerFinalTable(ctx, s) {
  const n = ctx.S.meta.n;
  return `<table class="breakdown"><thead><tr><th>#</th><th>Result</th><th>Time</th><th style="text-align:right">Points</th></tr></thead>
    <tbody>${Array.from({ length: n }, (_, i) => {
      const d = at(s.deltas, i) ?? 0;
      const pick = at(s.picks, i);
      const ms = at(s.times, i);
      const res = pick == null || pick < 0 ? '<span class="muted">No answer</span>' : d > 0 ? '<span class="up">✓ Correct</span>' : '<span class="down">✕ Wrong</span>';
      return `<tr><td>${i + 1}</td><td>${res}</td><td>${ms != null && ms >= 0 ? secs(ms) : '—'}</td><td class="n ${d > 0 ? 'up' : ''}">${fmt(d)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ projector (host) UI
function hostRevealCallouts({ S }, i) {
  const rows = Object.entries(S.players).map(([uid, p]) => {
    const s = S.scores[uid] || {};
    return { name: p.name, d: at(s.deltas, i) ?? 0, ms: at(s.times, i) ?? -1 };
  });
  const right = rows.filter((r) => r.d > 0).sort((a, b) => a.ms - b.ms);
  const timed = rows.filter((r) => r.ms >= 0);
  const avg = timed.length ? timed.reduce((t, r) => t + r.ms, 0) / timed.length : null;
  return `
    <div class="card"><div class="kicker k">Fastest correct</div><div class="v up">${right[0] ? `${esc(right[0].name)} <span class="muted" style="font-size:.6em">${secs(right[0].ms)} · +${fmt(right[0].d)}</span>` : '—'}</div></div>
    <div class="card"><div class="kicker k">Got it right</div><div class="v">${right.length} of ${rows.length}</div></div>
    <div class="card"><div class="kicker k">Average answer time</div><div class="v">${avg == null ? '—' : secs(avg)}</div></div>`;
}

function hostFinalChips({ S }, rows) {
  // Fastest finger: lowest average time on correct answers (min. 1 correct).
  let fast = null;
  for (const [uid, p] of Object.entries(S.players)) {
    const s = S.scores[uid] || {};
    const ts = toArr(s.times).filter((ms, q) => ms >= 0 && (at(s.deltas, q) || 0) > 0);
    if (!ts.length) continue;
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
    if (!fast || avg < fast.avg) fast = { name: p.name, avg };
  }
  const sharp = [...rows].sort((x, y) => y.correct - x.correct)[0];
  return `${fast ? `<span class="chip green">Fastest finger: ${esc(fast.name)} · ${secs(fast.avg)} avg</span>` : ''}
    ${sharp ? `<span class="chip purple">Sharpest: ${esc(sharp.name)} · ${sharp.correct}/${S.meta.n} correct</span>` : ''}`;
}

// ------------------------------------------------------------------ admin content
const AI_PROMPT = `You are writing an end-of-session recap quiz for a university trading society.
Today's education session covered: <TOPIC — e.g. "the Fed's dual mandate: inflation and the labour market">.
Write 10 multiple-choice questions that test whether members can APPLY the concepts, not just recall definitions:
- Mostly short hypothetical scenarios ("If payrolls miss and core PCE beats expectations, ...").
- 2–4 options each (use 2 for true/false), exactly one defensible correct answer, plausible distractors.
- Keep question text short enough to read in ~5 seconds — players are answering against the clock.
- A one-sentence explanation of WHY the answer is right.
- Order from easy to hard.
Return ONLY valid JSON in this exact shape:
{
  "mode": "quickfire",
  "title": "<session title> — recap",
  "weekOf": "YYYY-MM-DD",
  "questions": [
    { "text": "...", "options": ["...","...","...","..."], "correct": 0, "explanation": "..." }
  ]
}
("correct" is the 0-based index of the right option.)`;

// ------------------------------------------------------------------ mode definition
export default {
  id: 'quickfire',
  name: 'Quickfire',
  summary: 'Kahoot-style recap quiz — no categories or allocation. Points for being right and being fast.',
  chip: 'green',
  tagline: 'Fast and right wins',
  lobbyKicker: 'Session recap',
  defaults: DEFAULTS,
  withDefaults,
  usesCategories: false,
  hasAllocate: false,
  instantSubmit: true,
  settingFields: [
    { key: 'timer', label: 'Seconds per question', min: 5, step: 5 },
    { key: 'maxPoints', label: 'Max points per question', min: 100, step: 100 },
  ],
  settingsNote: 'Scoring — a right answer earns max points × (1 − time taken ÷ time limit ÷ 2): about 1,000 for an instant answer, 500 on the buzzer. Wrong or no answer: 0. One tap locks the answer in.',
  rules(st) {
    st = withDefaults(st);
    return [
      ['1 · Read fast', `${st.timer} seconds per question. The question is on the big screen and your phone.`],
      ['2 · Tap once', 'Your first tap is your final answer — no take-backs.'],
      ['3 · Right + fast', `Up to ${fmt(st.maxPoints)} pts for an instant right answer, at least ${fmt(st.maxPoints / 2)} if you're right on the buzzer.`],
    ];
  },
  issues(quiz) {
    const st = withDefaults(quiz?.settings);
    return st.timer > 0 ? [] : ['Quickfire needs a timer (seconds per question)'];
  },
  score: computeScores,
  sample: null,
  aiPrompt: AI_PROMPT,

  player: {
    lockedSummary: playerLockedSummary,
    revealLine: playerRevealLine,
    finalTable: playerFinalTable,
  },
  host: {
    questionHint: 'Tap fast — speed counts',
    revealCallouts: hostRevealCallouts,
    finalChips: hostFinalChips,
  },
};
