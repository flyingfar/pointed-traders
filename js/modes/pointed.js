// POINTED mode — the news quiz for risk-takers (modelled on Bloomberg's Pointed).
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

import { $, $$, esc, fmt, signed, at, toArr, isoLocal } from '../util.js';

// ------------------------------------------------------------------ rules
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

const DEFAULTS = { budget: 100, timer: 30, step: 5, minPer: 5, maxPer: 30 };
export const withDefaults = (st) => ({ ...DEFAULTS, ...(st || {}), limits: { ...LEVER_USES } });

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
  const st = withDefaults(settings);
  const out = {};
  for (const l of LEVERS) {
    if (l.k === 1) { out[l.key] = Infinity; continue; }
    out[l.key] = Math.max(0, st.limits[l.key] - (used?.[l.key] || 0));
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
        if (lev !== 1 && used[key] >= settings.limits[key]) lev = 1; // lever already used → no lever
        if (lev !== 1) used[key]++;
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

// ------------------------------------------------------------------ phone (player) UI
let draft = null; // allocation being edited
let lev = 1; // lever selected for the current question

const myStake = ({ S }, q) => allocFor(S.me.allocation, S.cats.length, S.meta.settings)[q] || 0;

function allocState({ S }) {
  const n = S.cats.length;
  if (!draft || draft.length !== n) {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(`pointed.draft.${S.pin}`)); } catch {}
    const saved = S.me.allocation ? toArr(S.me.allocation).map((v) => Math.floor(Number(v) || 0)) : null;
    draft = saved && saved.length === n ? saved
      : Array.isArray(d) && d.length === n ? d
      : evenSplit(n, withDefaults(S.meta.settings).budget);
  }
  return draft;
}

function playerAllocate(ctx) {
  const { S, db, app, setFoot } = ctx;
  const st = withDefaults(S.meta.settings);
  allocState(ctx);

  if (S.me.locked) {
    const alloc = allocFor(S.me.allocation, S.cats.length, st);
    app.innerHTML = `
      <div class="center" style="margin:18px 0"><div class="kicker">Portfolio locked</div><h1>Waiting for Q1</h1>
      <p class="muted">You can still tweak until the host starts.</p></div>
      <div class="card">${S.cats.map((c, i) => `
        <div class="alloc-row"><span class="num">${i + 1}</span><span class="cat">${esc(c)}</span><b>${alloc[i]}</b></div>`).join('')}
      </div>`;
    setFoot(`<button class="btn ghost block" id="edit">Edit allocation</button>`);
    $('#edit').onclick = () => db.set(`games/${S.pin}/players/${S.uid}/locked`, false);
    return;
  }

  app.innerHTML = `
    <div style="margin:10px 0 14px"><div class="kicker">Step 1 of 2 · Allocate</div>
      <h2>Split ${st.budget} points across the categories</h2>
      <p class="muted" style="margin:4px 0 0">Each category needs <b style="color:var(--ink)">${st.minPer}–${st.maxPer} points</b>. You start evenly spread — move points to where you're confident. You'll see each question only after you commit.</p></div>
    <div class="card" style="padding:6px 16px">${S.cats.map((c, i) => `
      <div class="alloc-row">
        <span class="num">${i + 1}</span><span class="cat">${esc(c)}</span>
        <div class="stepper">
          <button type="button" data-i="${i}" data-d="-1" aria-label="less">−</button>
          <input class="input" data-i="${i}" inputmode="numeric" value="${draft[i]}" />
          <button type="button" data-i="${i}" data-d="1" aria-label="more">+</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn ghost small" id="even">Reset to even split</button>
    </div>`;
  setFoot(`
    <div class="row"><b id="remain"></b><span class="spacer"></span><span class="muted" id="used"></span></div>
    <div class="budget-bar" id="bbar"><div></div></div>
    <button class="btn block big" id="lock" style="margin-top:10px">Lock in portfolio</button>`);

  const clamp = (v) => Math.min(st.maxPer, Math.max(st.minPer, v));
  const commit = () => {
    localStorage.setItem(`pointed.draft.${S.pin}`, JSON.stringify(draft));
    playerAllocateUpdate(ctx);
  };
  $$('.stepper button').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    const used = draft.reduce((a, v) => a + v, 0);
    let v = draft[i] + +b.dataset.d * st.step;
    if (+b.dataset.d > 0) v = Math.min(v, draft[i] + Math.max(0, st.budget - used));
    draft[i] = clamp(v);
    $(`.stepper input[data-i="${i}"]`).value = draft[i];
    commit();
  }));
  $$('.stepper input').forEach((inp) => {
    inp.oninput = () => {
      draft[+inp.dataset.i] = Math.floor(Number(inp.value.replace(/\D/g, '')) || 0);
      commit();
    };
    inp.onfocus = () => inp.select();
    inp.onblur = () => {
      draft[+inp.dataset.i] = clamp(draft[+inp.dataset.i]);
      inp.value = draft[+inp.dataset.i];
      commit();
    };
  });
  $('#even').onclick = () => {
    draft = evenSplit(draft.length, st.budget);
    $$('.stepper input').forEach((inp) => (inp.value = draft[+inp.dataset.i]));
    commit();
  };
  $('#lock').onclick = async () => {
    $('#lock').disabled = true;
    try {
      await db.update({
        [`games/${S.pin}/players/${S.uid}/allocation`]: draft,
        [`games/${S.pin}/players/${S.uid}/locked`]: true,
      });
    } catch (e) {
      alert('Could not lock in — the round may have started.');
      $('#lock').disabled = false;
    }
  };
  playerAllocateUpdate(ctx);
}

function playerAllocateUpdate({ S }) {
  if (!$('#remain') || !draft) return;
  const st = withDefaults(S.meta.settings);
  const used = draft.reduce((a, v) => a + v, 0);
  const problems = allocProblems(draft, st);
  const rem = st.budget - used;
  $('#remain').innerHTML = !problems.length ? '<span class="up">All points allocated ✓</span>'
    : rem > 0 && problems.length === 1 ? problems[0] : `<span class="down">${problems.join(' · ')}</span>`;
  $('#used').textContent = `${used} / ${st.budget}`;
  $('#bbar').classList.toggle('over', rem < 0);
  $('#bbar > div').style.width = Math.min(100, (used / st.budget) * 100) + '%';
  $$('.stepper input').forEach((inp) => {
    const v = draft[+inp.dataset.i];
    inp.style.borderColor = v < st.minPer || v > st.maxPer ? 'var(--down)' : '';
  });
  $('#lock').disabled = problems.length > 0;
}

function playerPanel(ctx) {
  const stake = myStake(ctx, ctx.S.meta.qIndex);
  return `<div class="card" style="padding:14px;margin-bottom:14px">
    <div class="row"><span class="kicker">Your stake</span><span class="spacer"></span><b>${fmt(stake)} pts</b></div>
    ${stake > 0 ? `
      <div class="row" style="margin-top:10px"><span class="kicker">Play a lever?</span><span class="spacer"></span><span class="muted" style="font-size:12px">Each one works once per game</span></div>
      <div class="lev-grid" style="margin-top:8px;grid-template-columns:repeat(3,1fr)">${PICKABLE.map((l) => `
        <button class="lev ${l.k === 0.5 ? 'h' : ''}" data-k="${l.k}" data-key="${l.key}"><b>${l.short}</b><small>${l.name}</small></button>`).join('')}
      </div>
      <div class="payoff" id="payoff"></div>`
    : `<p class="muted" style="margin:6px 0 0;font-size:14px">No points on this category — answer for accuracy bragging rights.</p>`}
  </div>`;
}

function playerRefreshPanel(ctx) {
  const { S } = ctx;
  const stake = myStake(ctx, S.meta.qIndex);
  const rem = remainingLevers(S.meta.settings, S.scores?.[S.uid]?.used);
  if (rem[levKey(lev)] <= 0) lev = 1;
  $$('.lev').forEach((b) => {
    const r = rem[b.dataset.key];
    b.disabled = r <= 0;
    b.classList.toggle('sel', +b.dataset.k === lev);
    b.querySelector('small').textContent = r <= 0 ? 'Used' : LEVERS.find((x) => x.key === b.dataset.key).name;
  });
  if ($('#payoff')) {
    $('#payoff').innerHTML = `<div class="w">Right ${signed(payoff(stake, lev, true))}</div><div class="l">Wrong ${signed(payoff(stake, lev, false))}</div>`;
  }
}

function playerLockedSummary(ctx) {
  const a = ctx.S.myAnswer;
  const stake = myStake(ctx, ctx.S.meta.qIndex);
  return `<div class="card stack">
    <div class="row"><span class="muted">Stake</span><span class="spacer"></span><b>${fmt(stake)} pts</b></div>
    <div class="row"><span class="muted">Lever</span><span class="spacer"></span><b class="${a.lev === 0.5 ? 'hedge' : ''}">${a.lev === 1 ? 'None' : levShort(a.lev)}${a.lev === 0.5 ? ' hedge' : ''}</b></div>
    <div class="payoff"><div class="w">If right ${signed(payoff(stake, a.lev, true))}</div><div class="l">If wrong ${signed(payoff(stake, a.lev, false))}</div></div>
  </div>`;
}

function playerRevealLine(ctx, s, q) {
  const a = ctx.S.myAnswer;
  if (!a) return 'You missed this one';
  const l = at(s?.levs, q) ?? a.lev;
  return `${fmt(myStake(ctx, q))} pts${l === 1 ? '' : ' at ' + levShort(l)}`;
}

function playerFinalTable(ctx, s) {
  const { S } = ctx;
  const alloc = allocFor(S.me.allocation, S.cats.length, S.meta.settings);
  return `<table class="breakdown"><thead><tr><th>#</th><th>Category</th><th>Stake</th><th>Lever</th><th style="text-align:right">P&amp;L</th></tr></thead>
    <tbody>${S.cats.map((c, i) => {
      const d = at(s.deltas, i) ?? 0;
      const pick = at(s.picks, i);
      return `<tr><td>${i + 1}</td><td>${esc(c)} ${pick == null || pick < 0 ? '<span class="muted">·</span>' : ''}</td><td>${alloc[i]}</td><td>${(at(s.levs, i) ?? 1) === 1 ? '<span class="muted">—</span>' : levShort(at(s.levs, i))}</td>
        <td class="n ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signed(d)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ projector (host) UI
function hostAllocate({ S, stage, setFoot, startQuestion, kick }) {
  const st = withDefaults(S.meta.settings);
  const players = Object.entries(S.players);
  const locked = players.filter(([, p]) => p.locked);
  S.key = 'allocate';
  stage.innerHTML = `
    <div class="row"><div><div class="kicker" style="font-size:16px">Step 1 · Allocate your ${st.budget} points · ${st.minPer}–${st.maxPer} per category</div>
      <h1 class="h-title">This week's categories</h1></div><span class="spacer"></span>
      <div class="center"><div style="font-size:64px;font-weight:800;line-height:1">${locked.length}<span class="muted" style="font-size:36px">/${players.length}</span></div><div class="muted">locked in</div></div>
    </div>
    <div class="cat-grid">${S.cats.map((c, i) => `<div class="card"><div class="n">${i + 1}</div><div class="c">${esc(c)}</div></div>`).join('')}</div>
    <div class="player-chips" style="margin-top:3vh">${players.map(([uid, p]) => `<span class="chip ${p.locked ? 'locked' : ''}" data-uid="${esc(uid)}">${esc(p.name)}${p.locked ? ' ✓' : ''}</span>`).join('')}</div>`;
  $$('.player-chips .chip').forEach((c) => (c.onclick = () => kick(c.dataset.uid, c.textContent.replace(' ✓', ''))));
  setFoot({
    primary: () => {
      const left = players.length - locked.length;
      if (left && !confirm(`${left} player(s) haven't locked in — they'll play with the default even split. Start anyway?`)) return;
      startQuestion(0);
    },
    label: 'Start question 1',
    hint: 'Players who never lock in play with an even split',
  });
}

function hostRevealCallouts({ S }, i) {
  const rows = Object.entries(S.players).map(([uid, p]) => {
    const s = S.scores[uid] || {};
    return { name: p.name, d: at(s.deltas, i) ?? 0, lev: at(s.levs, i) ?? 1, pick: at(s.picks, i) };
  });
  const best = rows.filter((r) => r.d > 0).sort((a, b) => b.d - a.d)[0];
  const worst = rows.filter((r) => r.d < 0).sort((a, b) => a.d - b.d)[0];
  const answered = rows.filter((r) => r.pick != null && r.pick >= 0);
  const tag = (r) => (r.lev !== 1 ? `<span class="muted" style="font-size:.6em">@ ${levShort(r.lev)}</span>` : '');
  return `
    <div class="card"><div class="kicker k">Best trade</div><div class="v up">${best ? `${esc(best.name)} ${signed(best.d)} ${tag(best)}` : '—'}</div></div>
    <div class="card"><div class="kicker k">Biggest blow-up</div><div class="v down">${worst ? `${esc(worst.name)} ${signed(worst.d)} ${tag(worst)}` : 'Nobody — well risk-managed'}</div></div>
    <div class="card"><div class="kicker k">Desk positioning</div><div class="v">${answered.filter((r) => r.lev >= 2).length} levered · <span class="hedge">${answered.filter((r) => r.lev === 0.5).length} hedged</span></div></div>`;
}

function hostFinalChips(ctx, rows) {
  let big = null;
  for (const r of rows) r.deltas.forEach((d, q) => { if (!big || d > big.d) big = { name: r.name, d, q, lev: r.levs[q] }; });
  const sharp = [...rows].sort((x, y) => y.correct - x.correct)[0];
  return `${big && big.d > 0 ? `<span class="chip green">Trade of the day: ${esc(big.name)} ${signed(big.d)} on Q${big.q + 1}${big.lev !== 1 ? ' @ ' + levShort(big.lev) : ''}</span>` : ''}
    ${sharp ? `<span class="chip purple">Sharpest: ${esc(sharp.name)} · ${sharp.correct}/${ctx.S.meta.n} correct</span>` : ''}`;
}

// ------------------------------------------------------------------ admin content
function sampleQuiz() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return {
    mode: 'pointed',
    title: 'Sample week — market basics',
    weekOf: isoLocal(monday),
    settings: { ...DEFAULTS },
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

const AI_PROMPT = `You are writing a weekly markets news quiz for a university trading society.
Using the most important financial/market headlines from the past 7 days, write 10 multiple-choice questions.
Rules:
- Each question gets a short CATEGORY (1–3 words, e.g. "Central Banks", "Earnings", "Hong Kong", "Crypto"). Categories are shown to players BEFORE the questions, so they must not give the answer away.
- 4 options each, exactly one correct, plausible distractors.
- A one-sentence explanation with the key fact.
- Mix difficulty: 3 easy, 4 medium, 3 hard.
Return ONLY valid JSON in this exact shape:
{
  "mode": "pointed",
  "title": "Week of <date>",
  "weekOf": "YYYY-MM-DD",
  "questions": [
    { "category": "...", "text": "...", "options": ["...","...","...","..."], "correct": 0, "explanation": "...", "source": "https://..." }
  ]
}
("correct" is the 0-based index of the right option.)`;

// ------------------------------------------------------------------ mode definition
export default {
  id: 'pointed',
  name: 'Pointed',
  summary: 'News quiz for risk-takers — allocate points blind, lever up or hedge. Accuracy only, no speed bonus.',
  chip: 'dark',
  tagline: 'The news quiz for risk-takers',
  lobbyKicker: 'Monday warm-up',
  defaults: DEFAULTS,
  withDefaults,
  usesCategories: true,
  hasAllocate: true,
  instantSubmit: false,
  settingFields: [
    { key: 'budget', label: 'Points budget', min: 10, step: 10 },
    { key: 'minPer', label: 'Min pts per category', min: 0 },
    { key: 'maxPer', label: 'Max pts per category', min: 1 },
    { key: 'timer', label: 'Timer (sec, 0 = none)', min: 0, step: 5 },
  ],
  settingsNote: 'Scoring — right = +stake, wrong = −stake. Levers scale both ways (0.5×: ±½ · 2×: ±2× · 3×: ±3×) and each can be played once per game. Players start with an even split (e.g. 100 pts / 10 = 10 each) and must keep every category within the min–max.',
  rules(st, n) {
    st = withDefaults(st);
    return [
      ['1 · Allocate', `Split ${st.budget} pts across ${n} categories (${st.minPer}–${st.maxPer} each) before seeing any question. Don't touch it and you play an even split.`],
      ['2 · Lever up or hedge', 'Right wins your stake, wrong loses it. Play a 0.5× hedge, 2× or 3× lever — gains and losses scale the same way, each lever once per game.'],
      ['3 · Be right', 'No speed bonus — only accuracy and conviction count.'],
    ];
  },
  issues(quiz) {
    const st = withDefaults(quiz?.settings);
    const qs = toArr(quiz?.questions);
    const out = [];
    if (st.minPer > st.maxPer) out.push('Min per category is above max');
    else if (qs.length && (st.minPer * qs.length > st.budget || st.maxPer * qs.length < st.budget))
      out.push(`Budget ${st.budget} can't be split ${st.minPer}–${st.maxPer} across ${qs.length} categories`);
    return out;
  },
  score: computeScores,
  sample: sampleQuiz,
  aiPrompt: AI_PROMPT,

  player: {
    allocate: playerAllocate,
    allocateUpdate: playerAllocateUpdate,
    resetSelection() { lev = 1; },
    panel: playerPanel,
    bindPanel(ctx, onChange) {
      // Tap a lever to play it, tap again to go back to no lever.
      $$('.lev').forEach((b) => (b.onclick = () => { lev = lev === +b.dataset.k ? 1 : +b.dataset.k; onChange(); }));
    },
    refreshPanel: playerRefreshPanel,
    payload: (ctx) => ({ lev: myStake(ctx, ctx.S.meta.qIndex) > 0 ? lev : 1 }),
    submitSuffix: (ctx) => (myStake(ctx, ctx.S.meta.qIndex) > 0 && lev !== 1 ? ' · ' + levShort(lev) : ''),
    lockedSummary: playerLockedSummary,
    revealLine: playerRevealLine,
    finalTable: playerFinalTable,
  },
  host: {
    allocate: hostAllocate,
    questionHint: 'Lever up or hedge — then lock in your answer',
    revealCallouts: hostRevealCallouts,
    finalChips: hostFinalChips,
  },
};
