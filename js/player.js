import { db } from './db.js';
import { CONFIG } from './config.js';
import { $, $$, esc, fmt, signed, at, toArr, ordinal, LETTERS, brandHTML, demoBanner, fmtWeek } from './util.js';
import { LEVERS, PICKABLE, payoff, levShort, remainingLevers, rankList, allocFor, allocProblems, evenSplit, withDefaults } from './game.js';

const app = $('#app');
const foot = $('#foot');
const footInner = $('#footInner');

const S = {
  uid: null, pin: null,
  meta: null, cats: [], me: null, myAnswer: null, scores: null, players: null,
  key: null, subs: [], ansSub: null, ansQ: null,
  sel: { choice: null, lev: 1 }, draft: null,
};

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
    <p class="muted center" style="font-size:14px;margin-top:22px">Split 100 points across 10 categories. Win or lose your stake on every answer — 0.5×, 2× and 3× levers once each.<br/>Speed doesn't matter — conviction does.</p>`;
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
  let key = m.state + ':' + (m.qIndex ?? '');
  if (m.state === 'allocate') key += S.me.locked ? ':L' : ':E';
  if (m.state === 'question') key += S.myAnswer ? ':A' : ':Q';
  const fresh = key !== S.key;
  S.key = key;
  const views = { lobby: vLobby, allocate: vAllocate, question: vQuestion, reveal: vReveal, board: vBoard, final: vFinal };
  // Views without inputs can safely re-render on every update; input views only mount once.
  if (fresh || ['lobby', 'reveal', 'board', 'final'].includes(m.state) || (m.state === 'question' && S.myAnswer)) {
    (views[m.state] || vLobby)(fresh);
  } else if (m.state === 'allocate' && !S.me.locked) {
    updateAllocTotals();
  } else if (m.state === 'question') {
    updateLevButtons();
  }
}

// ------------------------------------------------------------------ views
function vLobby() {
  setFoot('');
  const n = Object.keys(S.players || {}).length;
  app.innerHTML = `
    <div class="hero">
      <div class="result-badge ok" style="font-size:40px">✓</div>
      <h1>You're in, ${esc(S.me.name)}</h1>
      <p class="muted">${esc(S.meta.title || '')}${S.meta.weekOf ? ' · ' + esc(fmtWeek(S.meta.weekOf)) : ''}</p>
      <p>See your name on the screen? Sit tight — ${n} player${n === 1 ? '' : 's'} joined.</p>
    </div>
    <div class="card stack">
      <div class="kicker">How it works</div>
      <div><b>1 · Allocate.</b> Split ${withDefaults(S.meta.settings).budget} points across the ${S.cats.length} categories (${withDefaults(S.meta.settings).minPer}–${withDefaults(S.meta.settings).maxPer} each) before you see any question. If you don't change anything you play with an even split.</div>
      <div><b>2 · Lever up or hedge.</b> Right answers win your stake, wrong answers lose it. After reading a question you can play a <b>0.5× hedge</b>, <b>2×</b> or <b>3×</b> lever — gains and losses scale the same way. Each lever works <b>once per game</b>.</div>
      <div><b>3 · Answer.</b> No speed bonus — only accuracy and conviction count.</div>
    </div>`;
}

function allocSettings() {
  return withDefaults(S.meta.settings);
}

function allocState() {
  const n = S.cats.length;
  if (!S.draft || S.draft.length !== n) {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(`pointed.draft.${S.pin}`)); } catch {}
    const saved = S.me.allocation ? toArr(S.me.allocation).map((v) => Math.floor(Number(v) || 0)) : null;
    S.draft = saved && saved.length === n ? saved
      : Array.isArray(d) && d.length === n ? d
      : evenSplit(n, allocSettings().budget);
  }
  return S.draft;
}

function vAllocate() {
  const st = allocSettings();
  const draft = allocState();

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
    localStorage.setItem(`pointed.draft.${S.pin}`, JSON.stringify(S.draft));
    updateAllocTotals();
  };
  $$('.stepper button').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    const used = S.draft.reduce((a, v) => a + v, 0);
    let v = S.draft[i] + +b.dataset.d * st.step;
    if (+b.dataset.d > 0) v = Math.min(v, S.draft[i] + Math.max(0, st.budget - used));
    S.draft[i] = clamp(v);
    $(`.stepper input[data-i="${i}"]`).value = S.draft[i];
    commit();
  }));
  $$('.stepper input').forEach((inp) => {
    inp.oninput = () => {
      S.draft[+inp.dataset.i] = Math.floor(Number(inp.value.replace(/\D/g, '')) || 0);
      commit();
    };
    inp.onfocus = () => inp.select();
    inp.onblur = () => {
      S.draft[+inp.dataset.i] = clamp(S.draft[+inp.dataset.i]);
      inp.value = S.draft[+inp.dataset.i];
      commit();
    };
  });
  $('#even').onclick = () => {
    S.draft = evenSplit(S.draft.length, st.budget);
    $$('.stepper input').forEach((inp) => (inp.value = S.draft[+inp.dataset.i]));
    commit();
  };
  $('#lock').onclick = async () => {
    $('#lock').disabled = true;
    try {
      await db.update({
        [`games/${S.pin}/players/${S.uid}/allocation`]: S.draft,
        [`games/${S.pin}/players/${S.uid}/locked`]: true,
      });
    } catch (e) {
      alert('Could not lock in — the round may have started.');
      $('#lock').disabled = false;
    }
  };
  updateAllocTotals();
}

function updateAllocTotals() {
  if (!$('#remain')) return;
  const st = allocSettings();
  const used = S.draft.reduce((a, v) => a + v, 0);
  const problems = allocProblems(S.draft, st);
  const rem = st.budget - used;
  $('#remain').innerHTML = !problems.length ? '<span class="up">All points allocated ✓</span>'
    : rem > 0 && problems.length === 1 ? problems[0] : `<span class="down">${problems.join(' · ')}</span>`;
  $('#used').textContent = `${used} / ${st.budget}`;
  $('#bbar').classList.toggle('over', rem < 0);
  $('#bbar > div').style.width = Math.min(100, (used / st.budget) * 100) + '%';
  $$('.stepper input').forEach((inp) => {
    const v = S.draft[+inp.dataset.i];
    inp.style.borderColor = v < st.minPer || v > st.maxPer ? 'var(--down)' : '';
  });
  $('#lock').disabled = problems.length > 0;
}

function myStake(q) {
  return allocFor(S.me.allocation, S.cats.length, S.meta.settings)[q] || 0;
}

function vQuestion(fresh) {
  const m = S.meta, q = m.qIndex, Q = m.question || {};
  const stake = myStake(q);
  const opts = toArr(Q.options);

  if (S.myAnswer) {
    const a = S.myAnswer;
    setFoot('');
    app.innerHTML = `
      <div class="center" style="margin-top:30px">
        <div class="kicker">Question ${q + 1} of ${m.n} · ${esc(Q.category)}</div>
        <div class="result-badge na" style="background:var(--ink)">${LETTERS[a.choice]}</div>
        <h1>Locked in</h1>
        <p class="muted">${esc(opts[a.choice])}</p>
      </div>
      <div class="card stack">
        <div class="row"><span class="muted">Stake</span><span class="spacer"></span><b>${fmt(stake)} pts</b></div>
        <div class="row"><span class="muted">Lever</span><span class="spacer"></span><b class="${a.lev === 0.5 ? 'hedge' : ''}">${a.lev === 1 ? 'None' : levShort(a.lev)}${a.lev === 0.5 ? ' hedge' : ''}</b></div>
        <div class="payoff"><div class="w">If right ${signed(payoff(stake, a.lev, true))}</div><div class="l">If wrong ${signed(payoff(stake, a.lev, false))}</div></div>
      </div>
      <p class="center muted" style="margin-top:20px">Eyes on the screen for the reveal…</p>
      <p class="center" id="timer" style="font-weight:700"></p>`;
    return;
  }

  if (fresh) S.sel = { choice: null, lev: 1 };
  app.innerHTML = `
    <div style="margin:6px 0 12px">
      <div class="row"><span class="kicker">Q${q + 1} of ${m.n} · ${esc(Q.category)}</span><span class="spacer"></span><b id="timer"></b></div>
      <h2 style="margin-top:8px">${esc(Q.text)}</h2>
    </div>
    <div class="card" style="padding:14px">
      <div class="row"><span class="kicker">Your stake</span><span class="spacer"></span><b>${fmt(stake)} pts</b></div>
      ${stake > 0 ? `
        <div class="row" style="margin-top:10px"><span class="kicker">Play a lever?</span><span class="spacer"></span><span class="muted" style="font-size:12px">Each one works once per game</span></div>
        <div class="lev-grid" style="margin-top:8px;grid-template-columns:repeat(3,1fr)">${PICKABLE.map((l) => `
          <button class="lev ${l.k === 0.5 ? 'h' : ''}" data-k="${l.k}" data-key="${l.key}"><b>${l.short}</b><small>${l.name}</small></button>`).join('')}
        </div>
        <div class="payoff" id="payoff"></div>`
      : `<p class="muted" style="margin:6px 0 0;font-size:14px">No points on this category — answer for accuracy bragging rights.</p>`}
    </div>
    <div class="opts" style="margin-top:14px">${opts.map((o, i) => `
      <button class="opt" data-c="${i}"><span class="L">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}
    </div>`;
  setFoot(`<button class="btn block big" id="submit" disabled>Pick an answer</button>`);

  // Tap a lever to play it, tap again to go back to no lever.
  $$('.lev').forEach((b) => (b.onclick = () => { S.sel.lev = S.sel.lev === +b.dataset.k ? 1 : +b.dataset.k; updateLevButtons(); }));
  $$('.opt').forEach((b) => (b.onclick = () => {
    S.sel.choice = +b.dataset.c;
    $$('.opt').forEach((x) => x.classList.toggle('sel', +x.dataset.c === S.sel.choice));
    updateLevButtons();
  }));
  $('#submit').onclick = async () => {
    if (S.sel.choice == null) return;
    $('#submit').disabled = true;
    try {
      await db.set(`games/${S.pin}/answers/${q}/${S.uid}`, { choice: S.sel.choice, lev: stake > 0 ? S.sel.lev : 1, at: db.now() });
    } catch (e) {
      $('#submit').textContent = "Time's up — answer not accepted";
    }
  };
  updateLevButtons();
}

function updateLevButtons() {
  if (!$('#submit') || S.meta?.state !== 'question' || S.myAnswer) return;
  const stake = myStake(S.meta.qIndex);
  const rem = remainingLevers(S.meta.settings, S.scores?.[S.uid]?.used);
  if (rem[LEVERS.find((l) => l.k === S.sel.lev).key] <= 0) S.sel.lev = 1;
  $$('.lev').forEach((b) => {
    const r = rem[b.dataset.key];
    b.disabled = r <= 0;
    b.classList.toggle('sel', +b.dataset.k === S.sel.lev);
    const small = b.querySelector('small');
    const l = LEVERS.find((x) => x.key === b.dataset.key);
    small.textContent = r <= 0 ? 'Used' : l.name;
  });
  if ($('#payoff')) {
    $('#payoff').innerHTML = `<div class="w">Right ${signed(payoff(stake, S.sel.lev, true))}</div><div class="l">Wrong ${signed(payoff(stake, S.sel.lev, false))}</div>`;
  }
  const btn = $('#submit');
  btn.disabled = S.sel.choice == null;
  btn.textContent = S.sel.choice == null ? 'Pick an answer' : `Lock in ${LETTERS[S.sel.choice]}${stake > 0 && S.sel.lev !== 1 ? ' · ' + levShort(S.sel.lev) : ''}`;
}

function vReveal() {
  setFoot('');
  const m = S.meta, q = m.qIndex, Q = m.question || {}, R = m.reveal || {};
  const opts = toArr(Q.options);
  const a = S.myAnswer;
  const s = S.scores?.[S.uid];
  const d = at(s?.deltas, q) ?? 0;
  const ok = a && a.choice === R.correct;
  const badge = !a ? ['na', '–', 'No answer'] : ok ? ['ok', '✓', 'Correct'] : ['no', '✕', 'Wrong'];
  app.innerHTML = `
    <div class="center" style="margin-top:14px">
      <div class="kicker">Question ${q + 1} · ${esc(Q.category)}</div>
      <div class="result-badge ${badge[0]}">${badge[1]}</div>
      <h1>${badge[2]}</h1>
      <div class="big-num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" style="margin:6px 0">${signed(d)}</div>
      <p class="muted">${a ? `${fmt(myStake(q))} pts${(at(s?.levs, q) ?? a.lev) === 1 ? '' : ' at ' + levShort(at(s?.levs, q) ?? a.lev)}` : 'You missed this one'} · total <b style="color:var(--ink)">${fmt(s?.total ?? 0)}</b></p>
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
  const alloc = allocFor(S.me.allocation, S.cats.length, S.meta.settings);
  app.innerHTML = `
    <div class="center" style="margin-top:16px">
      <div class="kicker">Final result</div>
      <div style="font-size:64px;line-height:1;margin-top:10px">${medal}</div>
      <div class="big-num" style="margin:8px 0">${me ? ordinal(me.rank) : '–'}</div>
      <p class="muted">of ${rows.length} players</p>
      <div class="row" style="justify-content:center;margin:14px 0">
        <span class="chip dark" style="font-size:16px">${fmt(s.total ?? 0)} pts</span>
        <span class="chip" style="font-size:16px">${s.correct ?? 0}/${S.cats.length} correct</span>
      </div>
    </div>
    <div class="card" style="padding:12px 14px">
      <table class="breakdown"><thead><tr><th>#</th><th>Category</th><th>Stake</th><th>Lever</th><th style="text-align:right">P&amp;L</th></tr></thead>
      <tbody>${S.cats.map((c, i) => {
        const d = at(s.deltas, i) ?? 0;
        const pick = at(s.picks, i);
        return `<tr><td>${i + 1}</td><td>${esc(c)} ${pick == null || pick < 0 ? '<span class="muted">·</span>' : ''}</td><td>${alloc[i]}</td><td>${(at(s.levs, i) ?? 1) === 1 ? '<span class="muted">—</span>' : levShort(at(s.levs, i))}</td>
          <td class="n ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signed(d)}</td></tr>`;
      }).join('')}</tbody></table>
    </div>
    <p class="center muted" style="margin-top:20px">Thanks for playing — see you next Monday.</p>`;
}

// ------------------------------------------------------------------ timer tick
setInterval(() => {
  const el = $('#timer');
  if (!el || S.meta?.state !== 'question' || !S.meta.deadline) { if (el) el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((S.meta.deadline - db.now()) / 1000));
  el.textContent = left + 's';
  el.className = left <= 5 ? 'down' : '';
}, 250);
