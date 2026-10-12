// Projector (host) app — mode-independent flow; mode-specific screens come from js/modes/*.js.

import { db } from './db.js';
import { CONFIG } from './config.js';
import { $, $$, esc, fmt, signed, at, toArr, LETTERS, brandHTML, demoBanner, fmtWeek, clean } from './util.js';
import { rankList } from './game.js';
import { getMode } from './modes/index.js';

const stage = $('#stage');
const top = $('#top');
const foot = $('#foot');

const pin = new URLSearchParams(location.search).get('pin');
const G = `games/${pin}`;
const S = { meta: null, cats: [], players: {}, scores: {}, answers: {}, quiz: null, key: null, ansSub: null, ansQ: null, busy: false, primary: null };
const mode = () => getMode(S.meta?.mode);
// Handed to mode modules so they can draw their own screens (e.g. Pointed's allocation step).
const ctx = { S, db, stage, setFoot, startQuestion: (i) => startQuestion(i), kick: (uid, name) => kick(uid, name) };

init();

async function init() {
  demoBanner(db);
  if (!pin) return fatal('No game PIN in the URL. Launch a game from the admin page.');
  if (db.mode === 'firebase') {
    const u = await db.authReady();
    if (!u || u.isAnonymous || !(await db.isAdmin(u.uid))) {
      location.href = 'admin.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
      return;
    }
  }
  const hd = await db.get(`hostdata/${pin}`);
  if (!hd) return fatal(`Game ${pin} not found.`);
  S.quiz = hd.quiz;
  S.quiz.questions = toArr(S.quiz.questions).map((q) => ({ ...q, options: toArr(q.options) }));

  db.on(`${G}/meta`, (v) => { S.meta = v; syncAnswers(); render(); });
  db.on(`${G}/categories`, (v) => { S.cats = toArr(v); render(); });
  db.on(`${G}/players`, (v) => { S.players = v || {}; render(); });
  db.on(`${G}/scores`, (v) => { S.scores = v || {}; render(); });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); S.primary?.(); }
    if (e.key === 'f') document.documentElement.requestFullscreen?.();
  });
  setInterval(tick, 250);
}

function fatal(msg) {
  top.innerHTML = brandHTML();
  stage.innerHTML = `<div class="card" style="max-width:600px"><h2>${esc(msg)}</h2><a class="btn" href="admin.html">Go to admin</a></div>`;
}

function syncAnswers() {
  const q = S.meta?.qIndex;
  if (q == null || q < 0 || q === S.ansQ) return;
  S.ansSub?.();
  S.ansQ = q;
  S.answers = {};
  S.ansSub = db.on(`${G}/answers/${q}`, (v) => { S.answers = v || {}; render(); maybeAutoReveal(); });
}

// ------------------------------------------------------------------ chrome
function renderTop() {
  const m = S.meta;
  top.innerHTML = `${brandHTML()}<span class="spacer"></span>
    <span class="muted" style="font-size:18px">${esc(m?.title || '')}${m?.weekOf ? ' · ' + esc(fmtWeek(m.weekOf)) : ''}</span>
    <span class="spacer"></span>
    <span class="pin">PIN <b>${esc(pin)}</b></span>`;
}

function setFoot({ primary, label, secondary = [], hint = '' }) {
  S.primary = primary || null;
  foot.innerHTML = `
    <a class="btn ghost small" href="admin.html">← Admin</a>
    <button class="btn ghost small" id="fs">Fullscreen (F)</button>
    ${secondary.map((s, i) => `<button class="btn ${s.danger ? 'danger' : 'ghost'} small" data-sec="${i}">${esc(s.label)}</button>`).join('')}
    <span class="spacer"></span>
    <span class="hint">${esc(hint)}</span>
    ${primary ? `<button class="btn big" id="primary">${esc(label)} →</button>` : ''}`;
  $('#fs').onclick = () => document.documentElement.requestFullscreen?.();
  if (primary) $('#primary').onclick = () => primary();
  $$('[data-sec]').forEach((b) => (b.onclick = () => secondary[+b.dataset.sec].fn()));
}

// ------------------------------------------------------------------ actions
async function act(fn) {
  if (S.busy) return;
  S.busy = true;
  try { await fn(); } catch (e) { console.error(e); alert('Error: ' + e.message); } finally { S.busy = false; }
}

const startAllocation = () => act(() => db.update({ [`${G}/meta/state`]: 'allocate' }));

function startQuestion(i) { return act(async () => {
  const q = S.quiz.questions[i];
  const timer = Number(S.meta.settings?.timer) || 0;
  await db.update({
    [`${G}/meta/state`]: 'question',
    [`${G}/meta/qIndex`]: i,
    [`${G}/meta/qKey`]: String(i),
    [`${G}/meta/question`]: clean({ category: q.category, text: q.text, options: q.options }),
    [`${G}/meta/reveal`]: null,
    [`${G}/meta/deadline`]: timer > 0 ? db.now() + timer * 1000 + 600 : null,
    [`${G}/meta/started/${i}`]: db.ts(), // server clock — Quickfire measures answer speed from here
  });
}); }

const reveal = () => act(async () => {
  if (S.meta.state !== 'question') return;
  const i = S.meta.qIndex;
  // Close answering first so late writes are rejected by the rules, then score.
  await db.update({ [`${G}/meta/state`]: 'scoring' });
  const [players, answers, meta] = await Promise.all([db.get(`${G}/players`), db.get(`${G}/answers`), db.get(`${G}/meta`)]);
  const scores = mode().score({ settings: meta.settings, questions: S.quiz.questions, players: players || {}, answers: answers || {}, upTo: i, meta });
  const q = S.quiz.questions[i];
  const ansQ = at(answers, i) || {};
  const counts = q.options.map((_, c) => Object.values(ansQ).filter((a) => a.choice === c).length);
  await db.update({
    [`${G}/scores`]: clean(scores),
    [`${G}/meta/state`]: 'reveal',
    [`${G}/meta/reveal`]: clean({ correct: q.correct, explanation: q.explanation || '', counts }),
  });
});

const showBoard = () => act(() => db.update({ [`${G}/meta/state`]: 'board' }));
const showFinal = () => act(() => db.update({ [`${G}/meta/state`]: 'final' }));
function kick(uid, name) { if (confirm(`Remove ${name}?`)) db.remove(`${G}/players/${uid}`); }

function maybeAutoReveal() {
  if (S.meta?.state !== 'question') return;
  const n = Object.keys(S.players).length;
  const answered = Object.keys(S.answers).length;
  if (n > 0 && answered >= n && !S.autoTimer) {
    S.autoTimer = setTimeout(() => { S.autoTimer = null; if (S.meta.state === 'question') reveal(); }, 1200);
  }
}

function tick() {
  const m = S.meta;
  if (m?.state !== 'question') return;
  const el = $('#tleft');
  if (!m.deadline) return;
  const total = (Number(m.settings?.timer) || 30) * 1000;
  const left = Math.max(0, m.deadline - db.now());
  if (el) {
    el.textContent = Math.ceil(left / 1000);
    const ring = $('#ring');
    if (ring) ring.style.strokeDashoffset = String(503 * (1 - Math.min(1, left / total)));
    el.style.color = left < 5500 ? 'var(--down)' : '';
  }
  if (left <= 0) reveal();
}

// ------------------------------------------------------------------ render
function render() {
  if (!S.meta) return;
  renderTop();
  const m = S.meta;
  const M = mode();
  const views = { lobby: vLobby, allocate: () => M.host.allocate(ctx), question: vQuestion, scoring: vQuestion, reveal: vReveal, board: vBoard, final: vFinal };
  (views[m.state === 'allocate' && !M.hasAllocate ? 'lobby' : m.state] || vLobby)();
}

function joinUrl() {
  const u = new URL('index.html', location.href);
  u.search = '?pin=' + pin;
  return u.toString();
}

function vLobby() {
  const players = Object.entries(S.players);
  const url = joinUrl();
  if (S.key !== 'lobby' + S.cats.length) {
    S.key = 'lobby' + S.cats.length;
    const M = mode();
    stage.innerHTML = `
      <div class="lobby">
        <div class="join">
          <div class="kicker" style="font-size:16px">${esc(CONFIG.clubName)} · ${esc(M.lobbyKicker)} · <span class="chip ${M.chip}">${esc(M.name)}</span></div>
          <h1>${esc(M.tagline)}.</h1>
          <div class="tag">${esc(S.meta.title || '')}</div>
          <div class="join-box">
            <div id="qr"></div>
            <div>
              <div class="url">Join at <b style="color:var(--ink)">${esc(url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''))}</b></div>
              <div class="url" style="margin-top:10px">Game PIN</div>
              <div class="bigpin">${esc(pin)}</div>
            </div>
          </div>
          <div class="rules">${M.rules(S.meta.settings, S.cats.length).map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>
        </div>
        <div class="players-panel">
          <div class="count" id="pcount"></div>
          <div class="muted">Click a name to remove it</div>
          <div class="player-chips" id="chips"></div>
        </div>
      </div>`;
    if (window.QRCode) new QRCode($('#qr'), { text: url, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  }
  $('#pcount').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
  $('#chips').innerHTML = players
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .map(([uid, p]) => `<span class="chip" data-uid="${esc(uid)}">${esc(p.name)}</span>`).join('');
  $$('#chips .chip').forEach((c) => (c.onclick = () => kick(c.dataset.uid, c.textContent)));
  const M = mode();
  setFoot({
    primary: players.length ? (M.hasAllocate ? startAllocation : () => startQuestion(0)) : null,
    label: M.hasAllocate ? 'Start — allocate points' : 'Start question 1',
    hint: players.length ? 'Space ▸ next' : 'Waiting for players…',
  });
}

function vQuestion() {
  const m = S.meta, i = m.qIndex, Q = S.quiz.questions[i];
  const key = 'q' + i;
  const n = Object.keys(S.players).length;
  const answered = Object.keys(S.answers).length;
  if (S.key !== key) {
    S.key = key;
    stage.innerHTML = `
      <div class="q-head"><span class="chip dark">Question ${i + 1} / ${m.n}</span>${Q.category && mode().usesCategories ? `<span class="chip">${esc(Q.category)}</span>` : ''}</div>
      <div class="q-body">
        <div>
          <div class="q-text">${esc(Q.text)}</div>
          <div class="h-opts">${Q.options.map((o, c) => `<div class="h-opt"><span class="L">${LETTERS[c]}</span><span>${esc(o)}</span></div>`).join('')}</div>
        </div>
        <div class="timer">
          ${m.deadline ? `<svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="80" fill="none" stroke="var(--line)" stroke-width="10"/>
            <circle id="ring" cx="90" cy="90" r="80" fill="none" stroke="var(--ink)" stroke-width="10" stroke-linecap="round" stroke-dasharray="503" stroke-dashoffset="0" style="transition:stroke-dashoffset .25s linear"/></svg>
            <div class="t" id="tleft"></div>` : ''}
          <div class="answered"><b id="acount"></b>answered</div>
        </div>
      </div>`;
    tick();
  }
  $('#acount').textContent = `${answered}/${n}`;
  const scoring = m.state === 'scoring';
  setFoot({ primary: scoring ? null : reveal, label: 'Reveal answer', hint: scoring ? 'Scoring…' : mode().host.questionHint });
}

function vReveal() {
  const m = S.meta, i = m.qIndex, Q = S.quiz.questions[i], R = m.reveal || {};
  const counts = toArr(R.counts);
  const totalAns = counts.reduce((a, b) => a + b, 0) || 1;
  const nAns = counts.reduce((a, b) => a + b, 0);
  const pctRight = nAns ? Math.round(((counts[R.correct] || 0) / nAns) * 100) : 0;

  if (S.key !== 'r' + i) {
    S.key = 'r' + i;
    stage.innerHTML = `
      <div class="q-head"><span class="chip dark">Question ${i + 1} / ${m.n}</span>${Q.category && mode().usesCategories ? `<span class="chip">${esc(Q.category)}</span>` : ''}<span class="chip green">${pctRight}% got it right</span></div>
      <div class="q-text" style="font-size:clamp(24px,2.6vw,44px);margin:2.5vh 0">${esc(Q.text)}</div>
      <div class="h-opts">${Q.options.map((o, c) => `
        <div class="h-opt ${c === R.correct ? 'correct' : 'dim'}"><div class="bar" data-w="${(counts[c] || 0) / totalAns * 100}" style="width:0"></div>
          <span class="L">${c === R.correct ? '✓' : LETTERS[c]}</span><span>${esc(o)}</span><span class="cnt">${counts[c] || 0}</span></div>`).join('')}</div>
      ${R.explanation ? `<div class="explain">${esc(R.explanation)}</div>` : ''}
      <div class="callouts" id="callouts"></div>`;
    requestAnimationFrame(() => $$('.h-opt .bar').forEach((b) => (b.style.width = b.dataset.w + '%')));
  }
  $('#callouts').innerHTML = mode().host.revealCallouts(ctx, i);
  setFoot({ primary: showBoard, label: 'Standings' });
}

function vBoard() {
  const m = S.meta, i = m.qIndex;
  const rows = rankList(S.players, S.scores);
  // Previous ranks (before this question) for movement arrows
  const prevScores = Object.fromEntries(Object.entries(S.scores).map(([u, s]) => [u, { total: (s.total || 0) - (at(s.deltas, i) || 0), correct: s.correct }]));
  const prev = Object.fromEntries(rankList(S.players, prevScores).map((r) => [r.uid, r.rank]));
  const last = i + 1 >= m.n;
  S.key = 'b' + i;
  stage.innerHTML = `
    <div class="row"><div><div class="kicker" style="font-size:16px">After question ${i + 1} of ${m.n}</div><h1 class="h-title">Standings</h1></div></div>
    <div class="standings">${rows.slice(0, 8).map((r, k) => {
      const d = r.deltas[i] || 0;
      const mv = (prev[r.uid] || r.rank) - r.rank;
      return `<div class="r" style="animation-delay:${k * 60}ms"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}
        ${mv ? `<span class="${mv > 0 ? 'up' : 'down'}" style="font-size:.6em;margin-left:8px">${mv > 0 ? '▲' : '▼'}${Math.abs(mv)}</span>` : ''}</span>
        <span class="mv ${d > 0 ? 'up' : d < 0 ? 'down' : 'muted'}">${signed(d)}</span><span class="tt">${fmt(r.total)}</span></div>`;
    }).join('') || '<p class="muted">No players.</p>'}</div>`;
  setFoot({ primary: last ? showFinal : () => startQuestion(i + 1), label: last ? 'Final results' : `Question ${i + 2}` });
}

function vFinal() {
  const rows = rankList(S.players, S.scores);
  if (S.key !== 'final') {
    S.key = 'final';
    const [a, b, c] = rows;
    const slot = (r, cls, h, label, delay) => r ? `
      <div class="p ${cls}">
        <div class="who" style="animation-delay:${delay + 0.9}s">${esc(r.name)}</div>
        <div class="sc" style="animation-delay:${delay + 1}s">${fmt(r.total)} pts · ${r.correct}/${S.meta.n}</div>
        <div class="block" style="--h:${h};animation-delay:${delay}s">${label}</div>
      </div>` : `<div class="p"></div>`;
    stage.innerHTML = `
      <div class="center"><div class="kicker" style="font-size:16px">${esc(S.meta.title || '')}</div><h1 class="h-title">Final leaderboard</h1></div>
      <div class="podium">
        ${slot(b, 'second', '26vh', '2', 0.8)}
        ${slot(a, 'first', '36vh', '1', 1.6)}
        ${slot(c, 'third', '18vh', '3', 0)}
      </div>
      <div class="rest">${mode().host.finalChips(ctx, rows)}</div>
      <div class="rest">${rows.slice(3, 20).map((r) => `<span class="chip">${r.rank}. ${esc(r.name)} · ${fmt(r.total)}</span>`).join('')}</div>`;
  }
  setFoot({
    primary: null,
    secondary: [{ label: 'Download results (CSV)', fn: downloadCsv }],
    hint: 'See you next Monday',
  });
}

function downloadCsv() {
  const rows = rankList(S.players, S.scores);
  const n = S.meta.n;
  const head = ['rank', 'name', 'total', 'correct', ...Array.from({ length: n }, (_, i) => `q${i + 1}_points`)];
  const lines = [head.join(',')].concat(rows.map((r) =>
    [r.rank, `"${String(r.name).replace(/"/g, '""')}"`, r.total, r.correct, ...Array.from({ length: n }, (_, i) => r.deltas[i] ?? 0)].join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `pointed-${S.meta.weekOf || pin}.csv`;
  a.click();
}
