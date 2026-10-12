// Tiny realtime-DB adapter: Firebase Realtime Database in production,
// a localStorage-backed mock (syncs between tabs) in demo mode.
//
// API: init(), get(path), set(path, v), update({ 'a/b': v, ... }), remove(path),
//      on(path, cb) -> unsubscribe, now(), ts() (server timestamp), signInAnon(), signInEmail(e, p),
//      signOut(), authReady(), isAdmin(uid)

import { CONFIG } from './config.js';

const FB_VERSION = '10.12.2';
// ?demo forces local demo mode (for testing without touching the live database); it sticks for the tab.
const forceDemo = new URLSearchParams(location.search).has('demo')
  ? (sessionStorage.setItem('pointed.demo', '1'), true)
  : sessionStorage.getItem('pointed.demo') === '1';

function split(path) {
  return String(path).split('/').filter(Boolean);
}

// ---------------------------------------------------------------- demo mock
function createDemo() {
  const KEY = 'pointed-demo-db';
  const listeners = new Set();
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const save = (tree) => {
    localStorage.setItem(KEY, JSON.stringify(tree));
    notify();
  };
  const getAt = (tree, path) => split(path).reduce((n, k) => (n == null ? undefined : n[k]), tree);
  const prune = (node) => {
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        node[k] = prune(node[k]);
        if (node[k] == null) delete node[k];
      }
      if (!Object.keys(node).length) return null;
    }
    return node;
  };
  const setAt = (tree, path, val) => {
    const keys = split(path);
    if (!keys.length) return val;
    let n = tree;
    for (const k of keys.slice(0, -1)) {
      if (n[k] == null || typeof n[k] !== 'object') n[k] = {};
      n = n[k];
    }
    const v = val == null ? null : JSON.parse(JSON.stringify(val));
    if (v == null) delete n[keys.at(-1)];
    else n[keys.at(-1)] = v;
    return prune(tree) || {};
  };
  function notify() {
    const tree = load();
    for (const l of listeners) {
      const v = getAt(tree, l.path) ?? null;
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(v == null ? null : JSON.parse(s)); }
    }
  }
  window.addEventListener('storage', (e) => { if (e.key === KEY) notify(); });

  // Each *tab* is a separate player: keep uid in window.name (survives reload, not copied to new tabs).
  let uid = (window.name || '').startsWith('pt-') ? window.name.slice(3) : null;
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10); window.name = 'pt-' + uid; }

  return {
    mode: 'demo',
    async init() {},
    async get(path) { return getAt(load(), path) ?? null; },
    async set(path, val) { save(setAt(load(), path, val)); },
    async update(obj) {
      let t = load();
      for (const [p, v] of Object.entries(obj)) t = setAt(t, p, v);
      save(t);
    },
    async remove(path) { save(setAt(load(), path, null)); },
    on(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      queueMicrotask(() => {
        const v = getAt(load(), path) ?? null;
        l.last = JSON.stringify(v);
        cb(v);
      });
      return () => listeners.delete(l);
    },
    now: () => Date.now(),
    ts: () => Date.now(),
    async authReady() { return { uid, isAnonymous: false, email: 'demo@local' }; },
    async signInAnon() { return uid; },
    async signInEmail() { return { uid }; },
    async signOut() {},
    async isAdmin() { return true; },
    uid: () => uid,
  };
}

// ---------------------------------------------------------------- firebase
async function createFirebase(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [appM, dbM, authM] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-database.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = appM.initializeApp(cfg);
  const d = dbM.getDatabase(app);
  const a = authM.getAuth(app);
  let offset = 0;
  dbM.onValue(dbM.ref(d, '.info/serverTimeOffset'), (s) => (offset = s.val() || 0));

  const authReady = () =>
    new Promise((res) => {
      const off = authM.onAuthStateChanged(a, (u) => { off(); res(u); });
    });

  return {
    mode: 'firebase',
    async init() {},
    async get(path) { return (await dbM.get(dbM.ref(d, path))).val(); },
    set: (path, v) => dbM.set(dbM.ref(d, path), v),
    update: (obj) => dbM.update(dbM.ref(d), obj),
    remove: (path) => dbM.remove(dbM.ref(d, path)),
    on(path, cb) {
      return dbM.onValue(dbM.ref(d, path), (s) => cb(s.val()), (err) => console.error('[db]', path, err));
    },
    now: () => Date.now() + offset,
    // Server-side timestamp sentinel — the database fills in its own clock (used for answer timing).
    ts: () => dbM.serverTimestamp(),
    authReady,
    async signInAnon() {
      const u = await authReady();
      if (u) return u.uid;
      return (await authM.signInAnonymously(a)).user.uid;
    },
    async signInEmail(email, pw) { return (await authM.signInWithEmailAndPassword(a, email, pw)).user; },
    signOut: () => authM.signOut(a),
    async isAdmin(uid) {
      try { return (await dbM.get(dbM.ref(d, `admins/${uid}`))).val() === true; } catch { return false; }
    },
    uid: () => a.currentUser?.uid,
  };
}

export const db = CONFIG.firebase && CONFIG.firebase.apiKey && !forceDemo
  ? await createFirebase(CONFIG.firebase)
  : createDemo();
