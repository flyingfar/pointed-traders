import { db } from './db.js';
import { CONFIG } from './config.js';
import { $, $$, esc, toArr, clean, LETTERS, brandHTML, demoBanner, fmtWeek, toast } from './util.js';
import { DEFAULT_SETTINGS, blankQuestion, quizIssues, sampleQuiz, CATEGORY_SUGGESTIONS, AI_PROMPT, isoLocal } from './game.js';

const app = $('#app');
const S = { user: null, quizzes: {}, games: {}, admins: {}, subs: [], edit: null, editId: null, dirty: false };

init();

async function init() {
  demoBanner(db);
  if (db.mode === 'firebase') {
    const u = await db.authReady();
    if (!u || u.isAnonymous) return renderLogin();
    S.user = u;
    if (!(await db.isAdmin(u.uid))) return renderNotAdmin();
  } else {
    S.user = { uid: db.uid(), email: 'demo mode' };
    const qs = await db.get('quizzes');
    if (!qs) await db.set(`quizzes/${newId()}`, { ...sampleQuiz(), createdAt: Date.now(), updatedAt: Date.now() });
  }
  const next = new URLSearchParams(location.search).get('next');
  if (next && /^host\.html\?pin=\d+$/.test(next)) { location.href = next; return; }
  setBar();
  S.subs.push(db.on('quizzes', (v) => { S.quizzes = v || {}; route(); }));
  S.subs.push(db.on('games', (v) => { S.games = v || {}; if (!S.editId) route(); }));
  if (db.mode === 'firebase') S.subs.push(db.on('admins', (v) => { S.admins = v || {}; if (!S.editId) route(); }));
  const onHash = () => {
    if (location.hash === S.lastHash) return;
    if (S.dirty && !confirm('Discard unsaved changes?')) { history.replaceState(null, '', S.lastHash || '#/'); return; }
    S.dirty = false; S.edit = null; route();
  };
  window.addEventListener('hashchange', onHash);
  setInterval(onHash, 300); // fallback for embedded browsers that don't fire hashchange
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

function setBar() {
  $('#bar').innerHTML = `${brandHTML('Admin')}<span class="spacer"></span>
    <a class="btn ghost small" href="#/">Dashboard</a>
    <a class="btn ghost small" href="index.html" target="_blank">Player page ↗</a>
    <span class="muted" style="font-size:13px">${esc(S.user?.email || '')}</span>
    ${db.mode === 'firebase' ? '<button class="btn ghost small" id="logout">Sign out</button>' : ''}`;
  $('#logout')?.addEventListener('click', async () => { await db.signOut(); location.reload(); });
}

const newId = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ------------------------------------------------------------------ auth screens
function renderLogin(err = '') {
  $('#bar').innerHTML = brandHTML('Admin');
  app.innerHTML = `
    <form class="card stack" id="login" style="max-width:420px;margin:60px auto">
      <h1>Admin sign in</h1>
      <p class="muted" style="margin:0">For ${esc(CONFIG.clubName)} committee members.</p>
      <label class="field"><span>Email</span><input class="input" id="email" type="email" autocomplete="username" required /></label>
      <label class="field"><span>Password</span><input class="input" id="pw" type="password" autocomplete="current-password" required /></label>
      <div class="err">${esc(err)}</div>
      <button class="btn block">Sign in</button>
    </form>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await db.signInEmail($('#email').value.trim(), $('#pw').value);
      location.reload();
    } catch (ex) { renderLogin(ex.code === 'auth/invalid-credential' ? 'Wrong email or password.' : ex.message); }
  };
}

function renderNotAdmin() {
  $('#bar').innerHTML = brandHTML('Admin');
  app.innerHTML = `
    <div class="card stack" style="max-width:560px;margin:60px auto">
      <h1>Not an admin yet</h1>
      <p>You're signed in as <b>${esc(S.user.email)}</b>, but this account isn't on the admin list.</p>
      <p>Ask an existing admin to add this UID on the dashboard (or add <code>admins/&lt;uid&gt;: true</code> in the Firebase console):</p>
      <input class="input" readonly value="${esc(S.user.uid)}" onclick="this.select()" />
      <button class="btn ghost" id="out">Sign out</button>
    </div>`;
  $('#out').onclick = async () => { await db.signOut(); location.reload(); };
}

// ------------------------------------------------------------------ router
function route() {
  S.lastHash = location.hash;
  const h = location.hash.replace(/^#/, '') || '/';
  const m = h.match(/^\/edit\/(.+)$/);
  if (m) return renderEditor(m[1]);
  S.editId = null;
  S.renderedEditor = null;
  renderDashboard();
}

// ------------------------------------------------------------------ dashboard
function renderDashboard() {
  const quizzes = Object.entries(S.quizzes).sort((a, b) => String(b[1].weekOf || '').localeCompare(a[1].weekOf || '') || (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const games = Object.entries(S.games).sort((a, b) => (b[1].meta?.createdAt || 0) - (a[1].meta?.createdAt || 0));
  app.innerHTML = `
    <div class="row wrap">
      <div><h1>Weekly quizzes</h1><p class="muted" style="margin:4px 0 0">Write this week's questions, then hit <b>Launch</b> at the start of the Monday meeting.</p></div>
      <span class="spacer"></span>
      <button class="btn ghost" id="import">Import JSON</button>
      <button class="btn" id="new">+ New quiz</button>
    </div>
    <div class="quiz-list" style="margin-top:18px">
      ${quizzes.length ? quizzes.map(([id, q]) => {
        const issues = quizIssues(q);
        const n = toArr(q.questions).length;
        return `<div class="card quiz-card">
          <div class="row"><span class="kicker">${esc(fmtWeek(q.weekOf) || 'No date')}</span><span class="spacer"></span>
            ${issues.length ? `<span class="chip red" title="${esc(issues.join(', '))}">${issues.length} to fix</span>` : '<span class="chip green">Ready</span>'}</div>
          <div class="t">${esc(q.title || 'Untitled')}</div>
          <div class="muted" style="font-size:14px">${n} question${n === 1 ? '' : 's'} · ${esc(toArr(q.questions).map((x) => x.category).filter(Boolean).slice(0, 4).join(' · '))}${n > 4 ? '…' : ''}</div>
          <div class="actions">
            <a class="btn small" href="#/edit/${esc(id)}">Edit</a>
            <button class="btn small" style="background:var(--up);border-color:var(--up)" data-launch="${esc(id)}" ${issues.length ? 'disabled' : ''}>▶ Launch</button>
            <button class="btn ghost small" data-dup="${esc(id)}">Duplicate</button>
            <button class="btn ghost small" data-export="${esc(id)}">Export</button>
            <button class="btn danger small" data-del="${esc(id)}">Delete</button>
          </div>
        </div>`;
      }).join('') : `<div class="empty">No quizzes yet. <a href="#" id="loadSample">Load the sample quiz</a> or create a new one.</div>`}
    </div>

    <h2>Games</h2>
    ${games.length ? `<table class="list"><thead><tr><th>PIN</th><th>Quiz</th><th>Status</th><th>Players</th><th>Started</th><th></th></tr></thead><tbody>
      ${games.map(([pin, g]) => `<tr>
        <td><b>${esc(pin)}</b></td><td>${esc(g.meta?.title || '')}</td>
        <td>${esc(statusLabel(g.meta))}</td>
        <td>${Object.keys(g.players || {}).length}</td>
        <td class="muted">${g.meta?.createdAt ? new Date(g.meta.createdAt).toLocaleString() : ''}</td>
        <td style="text-align:right"><a class="btn small" href="host.html?pin=${esc(pin)}">Open host screen</a>
          <button class="btn danger small" data-delgame="${esc(pin)}">Delete</button></td>
      </tr>`).join('')}</tbody></table>`
    : '<div class="empty">No games yet — launch a quiz to get a PIN.</div>'}

    ${db.mode === 'firebase' ? `
    <h2>Admins</h2>
    <div class="card">
      <table class="list" style="border:0"><tbody>${Object.keys(S.admins).map((uid) => `<tr><td><code>${esc(uid)}</code>${uid === S.user.uid ? ' <span class="chip">you</span>' : ''}</td>
        <td style="text-align:right">${uid === S.user.uid ? '' : `<button class="btn danger small" data-deladmin="${esc(uid)}">Remove</button>`}</td></tr>`).join('')}</tbody></table>
      <form class="row" id="addAdmin" style="margin-top:12px">
        <input class="input" id="newAdmin" placeholder="UID of a committee member (they see it after signing in)" />
        <button class="btn">Add admin</button>
      </form>
    </div>` : ''}

    <h2>Weekly workflow</h2>
    <div class="card stack" style="font-size:15px">
      <div><b>1.</b> Over the weekend, click <b>Copy AI prompt</b>, paste it into Claude/ChatGPT with this week's headlines, and import the JSON — or write questions by hand with <b>New quiz</b>.</div>
      <div><b>2.</b> Fact-check every answer in the editor (the green letter is the correct option).</div>
      <div><b>3.</b> Monday: open this page on the lecture-room PC, hit <b>Launch</b>, put the host screen on the projector (press <b>F</b> for fullscreen).</div>
      <div><button class="btn ghost small" id="copyPrompt">Copy AI prompt</button></div>
    </div>`;

  $('#new').onclick = async () => {
    const id = newId();
    const q = { title: 'Week of ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), weekOf: nextMonday(), settings: structuredClone(DEFAULT_SETTINGS), questions: Array.from({ length: 10 }, blankQuestion), createdAt: Date.now(), updatedAt: Date.now() };
    await db.set(`quizzes/${id}`, q);
    location.hash = '#/edit/' + id;
  };
  $('#import').onclick = () => importModal();
  $('#copyPrompt').onclick = () => copy(AI_PROMPT, 'Prompt copied');
  $('#loadSample')?.addEventListener('click', async (e) => { e.preventDefault(); await db.set(`quizzes/${newId()}`, { ...sampleQuiz(), createdAt: Date.now(), updatedAt: Date.now() }); });
  $$('[data-launch]').forEach((b) => (b.onclick = () => launch(b.dataset.launch)));
  $$('[data-dup]').forEach((b) => (b.onclick = async () => {
    const src = S.quizzes[b.dataset.dup];
    await db.set(`quizzes/${newId()}`, { ...clean(src), title: (src.title || 'Untitled') + ' (copy)', createdAt: Date.now(), updatedAt: Date.now() });
    toast('Duplicated');
  }));
  $$('[data-export]').forEach((b) => (b.onclick = () => exportQuiz(S.quizzes[b.dataset.export])));
  $$('[data-del]').forEach((b) => (b.onclick = () => {
    const q = S.quizzes[b.dataset.del];
    if (confirm(`Delete "${q.title}"? This cannot be undone.`)) db.remove(`quizzes/${b.dataset.del}`);
  }));
  $$('[data-delgame]').forEach((b) => (b.onclick = () => {
    if (confirm(`Delete game ${b.dataset.delgame} and its results?`))
      db.update({ [`games/${b.dataset.delgame}`]: null, [`hostdata/${b.dataset.delgame}`]: null });
  }));
  $$('[data-deladmin]').forEach((b) => (b.onclick = () => { if (confirm('Remove this admin?')) db.remove(`admins/${b.dataset.deladmin}`); }));
  $('#addAdmin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = $('#newAdmin').value.trim();
    if (!/^[A-Za-z0-9]{10,}$/.test(uid)) return toast('That doesn\'t look like a UID');
    await db.set(`admins/${uid}`, true);
    toast('Admin added');
  });
}

function statusLabel(m) {
  if (!m) return '';
  return { lobby: 'Lobby', allocate: 'Allocating', question: `Q${m.qIndex + 1} live`, scoring: `Q${m.qIndex + 1}`, reveal: `Q${m.qIndex + 1} reveal`, board: `After Q${m.qIndex + 1}`, final: 'Finished' }[m.state] || m.state;
}

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return isoLocal(d);
}

async function launch(id) {
  const quiz = clean(S.quizzes[id]);
  const issues = quizIssues(quiz);
  if (issues.length) return alert('Fix these first:\n' + issues.join('\n'));
  quiz.questions = toArr(quiz.questions).map((q) => ({ ...q, options: toArr(q.options) }));
  let pin;
  for (let i = 0; i < 20; i++) {
    pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!(await db.get(`games/${pin}/meta`))) break;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(quiz.settings || {}), limits: { ...DEFAULT_SETTINGS.limits, ...(quiz.settings?.limits || {}) } };
  await db.update({
    [`hostdata/${pin}`]: clean({ quizId: id, quiz }),
    [`games/${pin}/meta`]: clean({
      state: 'lobby', title: quiz.title, weekOf: quiz.weekOf || '', settings, n: quiz.questions.length,
      qIndex: -1, qKey: '-1', createdAt: db.now(), host: S.user.uid,
    }),
    [`games/${pin}/categories`]: quiz.questions.map((q) => q.category),
  });
  location.href = 'host.html?pin=' + pin;
}

function exportQuiz(q) {
  const out = { title: q.title, weekOf: q.weekOf, settings: q.settings, questions: toArr(q.questions).map((x) => ({ ...x, options: toArr(x.options) })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = `pointed-${q.weekOf || 'quiz'}.json`;
  a.click();
}

function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg), () => {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast(msg);
  });
}

// Accepts our export format plus common LLM variations.
function normaliseImport(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(json)?|```$/gm, '').trim()) : raw;
  const list = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(list) || !list.length) throw new Error('No "questions" array found.');
  const questions = list.map((q, i) => {
    const options = toArr(q.options || q.choices || q.answers).map(String).slice(0, 4);
    let correct = q.correct ?? q.answer ?? q.correctIndex ?? q.correct_index;
    if (typeof correct === 'string') {
      const L = LETTERS.indexOf(correct.trim().toUpperCase());
      correct = L >= 0 && correct.trim().length === 1 ? L : options.findIndex((o) => o.trim().toLowerCase() === correct.trim().toLowerCase());
    }
    if (typeof correct !== 'number' || correct < 0 || correct >= options.length) correct = -1;
    return {
      category: String(q.category || q.topic || `Question ${i + 1}`),
      text: String(q.text || q.question || ''),
      options, correct,
      explanation: String(q.explanation || ''),
      source: String(q.source || ''),
    };
  });
  return {
    title: data.title || 'Imported quiz',
    weekOf: data.weekOf || nextMonday(),
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    questions,
  };
}

function importModal() {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal stack">
    <h3>Import quiz from JSON</h3>
    <p class="muted" style="margin:0;font-size:14px">Paste JSON from the AI prompt or a previous export. Fields: <code>title, weekOf, questions[{category, text, options[], correct, explanation}]</code>.</p>
    <textarea class="input" id="json" rows="14" placeholder='{ "title": "...", "questions": [ ... ] }' style="font-family:ui-monospace,monospace;font-size:13px"></textarea>
    <div class="row"><input type="file" id="file" accept=".json,application/json" /><span class="spacer"></span>
      <button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="go">Import</button></div>
    <div class="err" id="ierr"></div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $('#cancel', bg).onclick = close;
  $('#file', bg).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#json', bg).value = await f.text(); };
  $('#go', bg).onclick = async () => {
    try {
      const q = normaliseImport($('#json', bg).value);
      const id = newId();
      await db.set(`quizzes/${id}`, clean({ ...q, createdAt: Date.now(), updatedAt: Date.now() }));
      close();
      location.hash = '#/edit/' + id;
    } catch (ex) { $('#ierr', bg).textContent = 'Could not import: ' + ex.message; }
  };
}

// ------------------------------------------------------------------ editor
function renderEditor(id) {
  if (S.editId !== id || !S.edit) {
    const src = S.quizzes[id];
    if (!src) { app.innerHTML = '<p class="muted">Loading quiz…</p>'; return; }
    S.editId = id;
    S.edit = clean(src);
    S.edit.settings = { ...DEFAULT_SETTINGS, ...(S.edit.settings || {}), limits: { ...DEFAULT_SETTINGS.limits, ...(S.edit.settings?.limits || {}) } };
    S.edit.questions = toArr(S.edit.questions).map((q) => ({ ...blankQuestion(), ...q, options: toArr(q.options) }));
    S.dirty = false;
  } else if (S.renderedEditor === id) {
    return; // already mounted — don't clobber in-progress edits on remote updates
  }
  S.renderedEditor = id;
  drawEditor();
}

function drawEditor() {
  const Q = S.edit;
  const st = Q.settings;
  app.innerHTML = `
    <div class="row" style="margin-bottom:16px"><a href="#/" class="btn ghost small">← Back</a><span class="spacer"></span>
      <button class="btn ghost small" id="aiPrompt">Copy AI prompt</button>
      <button class="btn ghost small" id="replaceJson">Replace from JSON</button></div>
    <div class="card stack">
      <div class="editor-head">
        <label class="field"><span>Quiz title</span><input class="input" data-k="title" value="${esc(Q.title)}" placeholder="e.g. Week 5 — Fed cuts, Nvidia earnings" /></label>
        <label class="field"><span>Week of (Monday meeting)</span><input class="input" type="date" data-k="weekOf" value="${esc(Q.weekOf || '')}" /></label>
      </div>
      <div class="settings-grid">
        <label class="field"><span>Points budget</span><input class="input" type="number" min="10" step="10" data-s="budget" value="${st.budget}" /></label>
        <label class="field"><span>Timer (sec, 0 = none)</span><input class="input" type="number" min="0" step="5" data-s="timer" value="${st.timer}" /></label>
        <label class="field"><span>Min pts per category</span><input class="input" type="number" min="0" data-s="minPer" value="${st.minPer}" /></label>
        <label class="field"><span>Max pts per category</span><input class="input" type="number" min="1" data-s="maxPer" value="${st.maxPer}" /></label>
      </div>
      <p class="muted" style="margin:0;font-size:13px">Scoring — right = +stake, wrong = −stake. Levers scale both ways (0.5×: ±½ · 2×: ±2× · 3×: ±3×) and each can be played once per game. Players start with an even split (e.g. 100 pts / 10 = 10 each) and must keep every category within the min–max.</p>
    </div>
    <datalist id="cats">${CATEGORY_SUGGESTIONS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div id="qs">${Q.questions.map((q, i) => qCard(q, i)).join('')}</div>
    <button class="btn ghost block" id="addQ" style="margin-top:14px">+ Add question</button>
    <div class="savebar"><div class="inner">
      <span id="saveState"></span><span class="spacer"></span>
      <span class="muted" id="issues" style="font-size:13px;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button class="btn" id="save">Save</button>
      <button class="btn" id="saveLaunch" style="background:var(--up);border-color:var(--up)">Save &amp; launch ▶</button>
    </div></div>`;
  bindEditor();
  refreshStatus();
}

function qCard(q, i) {
  const issues = quizIssues({ title: 'x', questions: [q] }).map((s) => s.replace(/^Q1: /, ''));
  return `<div class="card q-card" data-q="${i}">
    <div class="qh"><span class="qn">Q${i + 1}</span>
      <span class="status chip ${issues.length ? 'red' : 'green'}">${issues.length ? 'Missing: ' + esc(issues.join(', ')) : 'Ready'}</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon-btn" data-act="down" title="Move down" ${i === S.edit.questions.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="icon-btn" data-act="del" title="Delete">✕</button>
    </div>
    <div class="grid2">
      <label class="field"><span>Category (shown before the question)</span><input class="input" list="cats" data-f="category" value="${esc(q.category)}" placeholder="e.g. Central Banks" /></label>
      <label class="field"><span>Question</span><textarea class="input" data-f="text" rows="2" placeholder="What did…">${esc(q.text)}</textarea></label>
    </div>
    <div style="margin-top:6px"><span style="font-size:13px;font-weight:600">Options <span class="muted" style="font-weight:400">— click a letter to mark the correct answer</span></span>
      ${q.options.map((o, j) => `<div class="opt-edit">
        <button class="L ${q.correct === j ? 'on' : ''}" data-act="correct" data-o="${j}" title="Mark correct">${LETTERS[j]}</button>
        <input class="input" data-o="${j}" value="${esc(o)}" placeholder="Option ${LETTERS[j]}" />
        <button class="icon-btn" data-act="delopt" data-o="${j}" title="Remove option" ${q.options.length <= 2 ? 'disabled' : ''}>−</button>
      </div>`).join('')}
      ${q.options.length < 4 ? `<button class="btn ghost small" data-act="addopt" style="margin:8px 0 0 42px">+ Option</button>` : ''}
    </div>
    <div class="grid2" style="margin-top:12px">
      <label class="field"><span>Source link (optional)</span><input class="input" data-f="source" value="${esc(q.source || '')}" placeholder="https://…" /></label>
      <label class="field"><span>Explanation (shown at reveal)</span><textarea class="input" data-f="explanation" rows="2" placeholder="One line of context…">${esc(q.explanation || '')}</textarea></label>
    </div>
  </div>`;
}

function bindEditor() {
  const Q = S.edit;
  const mark = () => { S.dirty = true; refreshStatus(); };
  $$('[data-k]').forEach((el) => (el.oninput = () => { Q[el.dataset.k] = el.value; mark(); }));
  $$('[data-s]').forEach((el) => (el.oninput = () => { Q.settings[el.dataset.s] = Math.max(0, Number(el.value) || 0); mark(); }));

  const qs = $('#qs');
  qs.oninput = (e) => {
    const card = e.target.closest('[data-q]');
    if (!card) return;
    const q = Q.questions[+card.dataset.q];
    if (e.target.dataset.f) q[e.target.dataset.f] = e.target.value;
    else if (e.target.dataset.o != null && e.target.tagName === 'INPUT') q.options[+e.target.dataset.o] = e.target.value;
    mark();
    refreshCard(+card.dataset.q);
  };
  qs.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = +b.closest('[data-q]').dataset.q;
    const q = Q.questions[i];
    const o = +b.dataset.o;
    switch (b.dataset.act) {
      case 'correct': q.correct = o; break;
      case 'addopt': q.options.push(''); break;
      case 'delopt':
        q.options.splice(o, 1);
        if (q.correct === o) q.correct = -1; else if (q.correct > o) q.correct--;
        break;
      case 'up': [Q.questions[i - 1], Q.questions[i]] = [Q.questions[i], Q.questions[i - 1]]; break;
      case 'down': [Q.questions[i + 1], Q.questions[i]] = [Q.questions[i], Q.questions[i + 1]]; break;
      case 'del':
        if (!confirm(`Delete Q${i + 1}?`)) return;
        Q.questions.splice(i, 1); break;
    }
    S.dirty = true;
    const y = window.scrollY;
    drawEditor();
    window.scrollTo(0, y);
  };
  $('#addQ').onclick = () => { Q.questions.push(blankQuestion()); S.dirty = true; drawEditor(); window.scrollTo(0, document.body.scrollHeight); };
  $('#save').onclick = () => save();
  $('#saveLaunch').onclick = async () => { if (await save()) { S.dirty = false; launch(S.editId); } };
  $('#aiPrompt').onclick = () => copy(AI_PROMPT, 'Prompt copied');
  $('#replaceJson').onclick = () => {
    const raw = prompt('Paste quiz JSON — this replaces all questions in the editor (not saved until you click Save):');
    if (!raw) return;
    try {
      const q = normaliseImport(raw);
      Object.assign(Q, { title: q.title || Q.title, weekOf: q.weekOf || Q.weekOf, questions: q.questions.map((x) => ({ ...blankQuestion(), ...x })) });
      S.dirty = true; drawEditor();
    } catch (ex) { alert('Could not parse: ' + ex.message); }
  };
  document.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.editId) { e.preventDefault(); save(); } };
}

function refreshCard(i) {
  const card = $(`[data-q="${i}"]`);
  const issues = quizIssues({ title: 'x', questions: [S.edit.questions[i]] }).map((s) => s.replace(/^Q1: /, ''));
  const chip = $('.status', card);
  chip.className = 'status chip ' + (issues.length ? 'red' : 'green');
  chip.textContent = issues.length ? 'Missing: ' + issues.join(', ') : 'Ready';
}

function refreshStatus() {
  const issues = quizIssues(S.edit);
  $('#saveState').innerHTML = S.dirty ? '<span class="dirty-dot"></span> Unsaved changes' : '<span class="muted">All changes saved</span>';
  $('#issues').textContent = issues.length ? `${issues.length} to fix: ${issues.join(', ')}` : '✓ Ready to launch';
  $('#saveLaunch').disabled = issues.length > 0;
}

async function save() {
  try {
    const out = clean({ ...S.edit, updatedAt: Date.now() });
    await db.set(`quizzes/${S.editId}`, out);
    S.dirty = false;
    refreshStatus();
    toast('Saved');
    return true;
  } catch (e) {
    alert('Save failed: ' + e.message);
    return false;
  }
}
