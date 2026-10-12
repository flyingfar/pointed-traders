// Phone (player) app — mode-independent flow: join → lobby → [mode pre-game phase] →
// question → reveal → standings → final. Mode-specific pieces come from js/modes/*.js.

import { db } from './db.js';
import { CONFIG } from './config.js';
import { $, $$, esc, fmt, signed, at, toArr, ordinal, LETTERS, brandHTML, demoBanner, fmtWeek } from './util.js';
import { rankList } from './game.js';
import { getMode } from './modes/index.js';

const app = $('#app');
const foot = $('#foot');
const footInner = $('#footInner');

const S = {
  uid: null, pin: null,
  meta: null, cats: [], me: null, myAnswer: null, scores: null, players: null,
  key: null, subs: [], ansSub: null, ansQ: null,
  choice: null, submitting: false,
};
const ctx = { S, db, app, setFoot };
const mode = () => getMode(S.meta?.mode);

init();

async function init() {
  demoBanner(db);
  setBar();
  try {
    S.uid = await db.signInAnon();
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Can't connect</h2><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  const qp = new URLSearchParams(location.search);
  const pin = (qp.get('pin') || '').trim();
  const tryPin = pin || localStorage.getItem('pointed.lastPin');
  if (tryPin) {
    const p = await db.get(`games/${tryPin}/players/${S.uid}`).catch(() => null);
    const m = p && (await db.get(`games/${tryPin}/meta`).catch(() => null));
    if (p && m) return enter(tryPin);
  }
  renderJoin(pin);
}

function setBar() {
  const s = S.scores?.[S.uid];
  $('#bar').innerHTML = `${brandHTML(false)}<span class="spacer"></span>${
    S.me ? `<span class="chip">${esc(S.me.name)}</span>` : ''
  }${s && S.meta && ['reveal', 'board', 'final', 'question'].includes(S.meta.state) ? `<span class="chip dark">${fmt(s.total)} pts</span>` : ''}`;
}

function setFoot(html) {
  if (!html) { foot.classList.add('hidden'); footInner.innerHTML = ''; return; }
  foot.classList.remove('hidden');
  footInner.innerHTML = html;
}

// ------------------------------------------------------------------ join
function renderJoin(pin = '', error = '') {
  S.key = null;
  setFoot('');
  app.innerHTML = `
    <div class="hero">
      <div class="kicker">${esc(CONFIG.clubName)}</div>
      <h1 style="font-size:44px;margin:6px 0 0">${esc(CONFIG.gameName)}<span class="hedge">.</span></h1>
      <div class="tag">${esc(CONFIG.tagline)}</div>
    </div>
    <form class="card stack" id="joinForm" autocomplete="off">
      <label class="field"><span>Game PIN</span>
        <input class="input pin-input" id="pin" inputmode="numeric" maxlength="6" placeholder="••••••" value="${esc(pin)}" required />
      </label>
      <label class="field"><span>Nickname</span>
        <input class="input" id="name" maxlength="20" placeholder="Your name on the leaderboard" value="${esc(localStorage.getItem('pointed.name') || '')}" required />
      </label>
      <div class="err" id="err">${esc(error)}</div>
      <button class="btn block big" id="joinBtn">Join game</button>
    </form>
    <p class="muted center" style="font-size:14px;margin-top:22px">Enter the PIN on the big screen. You'll answer on your phone — results show up on the screen and here.</p>`;
  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const pin = $('#pin').value.trim();
    const name = $('#name').value.trim().replace(/\s+/g, ' ');
    const err = $('#err');
    const btn = $('#joinBtn');
    if (!/^\d{4,6}$/.test(pin)) return (err.textContent = 'Enter the PIN shown on the screen.');
    if (!name) return (err.textContent = 'Pick a nickname.');
    btn.disabled = true; err.textContent = '';
    try {
      const meta = await db.get(`games/${pin}/meta`);
      if (!meta) throw new Error('No game with that PIN.');
      const players = (await db.get(`games/${pin}/players`)) || {};
      if (players[S.uid]) { localStorage.setItem('pointed.lastPin', pin); return enter(pin); }
      if (!['lobby', 'allocate'].includes(meta.state)) throw new Error('This game has already started.');
      if (Object.values(players).some((p) => p.name.toLowerCase() === name.toLowerCase()))
        throw new Error('That nickname is taken — try another.');
      await db.set(`games/${pin}/players/${S.uid}`, { name, joinedAt: db.now() });
      localStorage.setItem('pointed.lastPin', pin);
      localStorage.setItem('pointed.name', name);
      enter(pin);
    } catch (ex) {
      err.textContent = ex.message || 'Could not join.';
      btn.disabled = false;
    }
  };
}

// ------------------------------------------------------------------ subscriptions
function enter(pin) {
  S.pin = pin;
  S.subs.forEach((u) => u());
  const g = `games/${pin}`;
  S.subs = [
    db.on(`${g}/meta`, (v) => { S.meta = v; syncAnswerSub(); render(); }),
    db.on(`${g}/categories`, (v) => { S.cats = toArr(v); render(); }),
    db.on(`${g}/players`, (v) => { S.players = v || {}; S.me = S.players[S.uid] || null; render(); }),
    db.on(`${g}/scores`, (v) => { S.scores = v || {}; render(); }),
  ];
}

function syncAnswerSub() {
  const q = S.meta?.qIndex;
  if (q == null || q < 0 || q === S.ansQ) return;
  S.ansSub?.();
  S.ansQ = q;
  S.myAnswer = null;
  S.ansSub = db.on(`games/${S.pin}/answers/${q}/${S.uid}`, (v) => { S.myAnswer = v; render(); });
}

// ------------------------------------------------------------------ render router
function render() {
  setBar();
  const m = S.meta;
  if (!S.pin) return;
  if (m === null) {
    S.key = 'gone';
    setFoot('');
    app.innerHTML = `<div class="hero"><h1>Game closed</h1><p class="muted">The host ended this game.</p></div>
      <button class="btn block" id="again">Join another game</button>`;
    $('#again').onclick = () => { localStorage.removeItem('pointed.lastPin'); location.href = location.pathname; };
    return;
  }
  if (!m || S.players == null) return;
  if (!S.me) {
    localStorage.removeItem('pointed.lastPin');
    S.subs.forEach((u) => u()); S.subs = []; S.pin = null;
    return renderJoin('', 'You were removed from the game.');
  }
  if (m.state === 'scoring') {
    if (S.key === 'scoring:' + m.qIndex) return;
    S.key = 'scoring:' + m.qIndex;
    setFoot('');
    app.innerHTML = `<div class="hero"><div class="kicker">Question ${m.qIndex + 1}</div><h1>${S.myAnswer ? 'Locked in' : "Time's up"}</h1><p class="muted">Scoring the round…</p></div>`;
    return;
  }
  const M = mode();
  const state = m.state === 'allocate' && !M.hasAllocate ? 'lobby' : m.state;
  let key = state + ':' + (m.qIndex ?? '');
  if (state === 'allocate') key += S.me.locked ? ':L' : ':E';
  if (state === 'question') key += S.myAnswer ? ':A' : ':Q';
  const fresh = key !== S.key;
  S.key = key;
  const views = { lobby: vLobby, allocate: () => M.player.allocate(ctx), question: vQuestion, reveal: vReveal, board: vBoard, final: vFinal };
  // Views without inputs can safely re-render on every update; input views only mount once.
  if (fresh || ['lobby', 'reveal', 'board', 'final'].includes(state) || (state === 'question' && S.myAnswer)) {
    (views[state] || vLobby)(fresh);
  } else if (state === 'allocate' && !S.me.locked) {
    M.player.allocateUpdate?.(ctx);
  } else if (state === 'question') {
    refreshQuestion();
  }
}

// ------------------------------------------------------------------ views
function vLobby() {
  setFoot('');
  const n = Object.keys(S.players || {}).length;
  const M = mode();
  app.innerHTML = `
    <div class="hero">
      <div class="result-badge ok" style="font-size:40px">✓</div>
      <h1>You're in, ${esc(S.me.name)}</h1>
      <p class="muted">${esc(S.meta.title || '')}${S.meta.weekOf ? ' · ' + esc(fmtWeek(S.meta.weekOf)) : ''}</p>
      <p>See your name on the screen? Sit tight — ${n} player${n === 1 ? '' : 's'} joined.</p>
    </div>
    <div class="card stack">
      <div class="row"><span class="kicker">How it works</span><span class="spacer"></span><span class="chip ${M.chip}">${esc(M.name)}</span></div>
      ${M.rules(S.meta.settings, S.cats.length).map(([t, d]) => `<div><b>${esc(t)}.</b> ${esc(d)}</div>`).join('')}
    </div>`;
}

function vQuestion(fresh) {
  const M = mode();
  const m = S.meta, q = m.qIndex, Q = m.question || {};
  const opts = toArr(Q.options);
  const head = `${q + 1} of ${m.n}${Q.category && M.usesCategories ? ' · ' + esc(Q.category) : ''}`;

  if (S.myAnswer) {
    const a = S.myAnswer;
    setFoot('');
    app.innerHTML = `
      <div class="center" style="margin-top:30px">
        <div class="kicker">Question ${head}</div>
        <div class="result-badge na" style="background:var(--ink)">${LETTERS[a.choice]}</div>
        <h1>Locked in</h1>
        <p class="muted">${esc(opts[a.choice])}</p>
      </div>
      ${M.player.lockedSummary(ctx)}
      <p class="center muted" style="margin-top:20px">Eyes on the screen for the reveal…</p>
      <p class="center" id="timer" style="font-weight:700"></p>`;
    return;
  }

  if (fresh) { S.choice = null; S.submitting = false; M.player.resetSelection?.(); }
  app.innerHTML = `
    <div style="margin:6px 0 12px">
      <div class="row"><span class="kicker">Q${head}</span><span class="spacer"></span><b id="timer"></b></div>
      <h2 style="margin-top:8px">${esc(Q.text)}</h2>
    </div>
    ${M.player.panel?.(ctx) || ''}
    <div class="opts">${opts.map((o, i) => `
      <button class="opt" data-c="${i}"><span class="L">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}
    </div>
    <p class="err center" id="qerr" style="margin-top:10px"></p>`;

  if (M.instantSubmit) {
    // Quickfire: the first tap is the answer.
    setFoot('');
    $$('.opt').forEach((b) => (b.onclick = () => { S.choice = +b.dataset.c; submit(); }));
  } else {
    setFoot(`<button class="btn block big" id="submit" disabled>Pick an answer</button>`);
    $$('.opt').forEach((b) => (b.onclick = () => { S.choice = +b.dataset.c; refreshQuestion(); }));
    $('#submit').onclick = submit;
    M.player.bindPanel?.(ctx, refreshQuestion);
  }
  refreshQuestion();
}

function refreshQuestion() {
  if (S.meta?.state !== 'question' || S.myAnswer) return;
  const M = mode();
  $$('.opt').forEach((x) => x.classList.toggle('sel', +x.dataset.c === S.choice));
  M.player.refreshPanel?.(ctx);
  const btn = $('#submit');
  if (!btn) return;
  btn.disabled = S.choice == null || S.submitting;
  btn.textContent = S.choice == null ? 'Pick an answer' : `Lock in ${LETTERS[S.choice]}${M.player.submitSuffix?.(ctx) || ''}`;
}

async function submit() {
  if (S.choice == null || S.submitting) return;
  S.submitting = true;
  $$('.opt').forEach((b) => (b.disabled = true));
  refreshQuestion();
  try {
    await db.set(`games/${S.pin}/answers/${S.meta.qIndex}/${S.uid}`, {
      choice: S.choice,
      ...(mode().player.payload?.(ctx) || {}),
      at: db.ts(),
    });
  } catch (e) {
    $('#qerr').textContent = "Time's up — answer not accepted";
  }
}

function vReveal() {
  setFoot('');
  const M = mode();
  const m = S.meta, q = m.qIndex, Q = m.question || {}, R = m.reveal || {};
  const opts = toArr(Q.options);
  const a = S.myAnswer;
  const s = S.scores?.[S.uid];
  const d = at(s?.deltas, q) ?? 0;
  const ok = a && a.choice === R.correct;
  const badge = !a ? ['na', '–', 'No answer'] : ok ? ['ok', '✓', 'Correct'] : ['no', '✕', 'Wrong'];
  app.innerHTML = `
    <div class="center" style="margin-top:14px">
      <div class="kicker">Question ${q + 1}${Q.category && M.usesCategories ? ' · ' + esc(Q.category) : ''}</div>
      <div class="result-badge ${badge[0]}">${badge[1]}</div>
      <h1>${badge[2]}</h1>
      <div class="big-num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" style="margin:6px 0">${signed(d)}</div>
      <p class="muted">${M.player.revealLine(ctx, s, q)} · total <b style="color:var(--ink)">${fmt(s?.total ?? 0)}</b></p>
    </div>
    <div class="opts" style="margin-top:18px">${opts.map((o, i) => `
      <div class="opt ${i === R.correct ? 'correct' : a && a.choice === i ? 'wrong' : ''}"><span class="L">${LETTERS[i]}</span><span>${esc(o)}</span></div>`).join('')}
    </div>
    ${R.explanation ? `<p class="muted" style="margin-top:14px">${esc(R.explanation)}</p>` : ''}`;
}

function myRankInfo() {
  const rows = rankList(S.players, S.scores);
  const me = rows.find((r) => r.uid === S.uid);
  return { rows, me };
}

function vBoard() {
  setFoot('');
  const { rows, me } = myRankInfo();
  app.innerHTML = `
    <div class="center" style="margin-top:20px">
      <div class="kicker">Standings after Q${S.meta.qIndex + 1}</div>
      <div class="big-num" style="margin:14px 0 4px">${me ? ordinal(me.rank) : '–'}</div>
      <p class="muted">of ${rows.length} · ${fmt(me?.total ?? 0)} pts</p>
    </div>
    <div class="card mini-board">${rows.slice(0, 5).map((r) => `
      <div class="r ${r.uid === S.uid ? 'me' : ''}"><span class="rk">${r.rank}</span><span>${esc(r.name)}</span><span class="spacer"></span><b>${fmt(r.total)}</b></div>`).join('')}
      ${me && me.rank > 5 ? `<div class="r me"><span class="rk">${me.rank}</span><span>${esc(me.name)}</span><span class="spacer"></span><b>${fmt(me.total)}</b></div>` : ''}
    </div>`;
}

function vFinal() {
  setFoot('');
  const { rows, me } = myRankInfo();
  const s = S.scores?.[S.uid] || {};
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[me?.rank] || '';
  app.innerHTML = `
    <div class="center" style="margin-top:16px">
      <div class="kicker">Final result</div>
      <div style="font-size:64px;line-height:1;margin-top:10px">${medal}</div>
      <div class="big-num" style="margin:8px 0">${me ? ordinal(me.rank) : '–'}</div>
      <p class="muted">of ${rows.length} players</p>
      <div class="row" style="justify-content:center;margin:14px 0">
        <span class="chip dark" style="font-size:16px">${fmt(s.total ?? 0)} pts</span>
        <span class="chip" style="font-size:16px">${s.correct ?? 0}/${S.meta.n} correct</span>
      </div>
    </div>
    <div class="card" style="padding:12px 14px">${mode().player.finalTable(ctx, s)}</div>
    <p class="center muted" style="margin-top:20px">Thanks for playing — see you next Monday.</p>`;
}

// ------------------------------------------------------------------ timer tick
setInterval(() => {
  const el = $('#timer');
  if (!el || S.meta?.state !== 'question' || !S.meta.deadline) { if (el) el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((S.meta.deadline - db.now()) / 1000));
  el.textContent = left + 's';
  el.classList.toggle('down', left <= 5);
}, 250);
