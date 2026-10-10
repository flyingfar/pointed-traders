import { CONFIG } from './config.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const LETTERS = 'ABCD';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Firebase returns arrays as either arrays or {0:..,1:..} objects — normalise.
export const toArr = (x) =>
  Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : [];
export const at = (x, i) => (x ? x[i] ?? x[String(i)] : undefined);

export const fmt = (n) => {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
};
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Strip undefined so Firebase doesn't throw.
export const clean = (o) => JSON.parse(JSON.stringify(o ?? null));

export const fmtWeek = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return 'Week of ' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function brandHTML(sub) {
  return `<div class="brand"><span class="logo">${esc(CONFIG.gameName)}<span class="dot">.</span></span>${
    sub !== false ? `<span class="sub">${esc(sub ?? CONFIG.clubName + ' edition')}</span>` : ''
  }</div>`;
}

export function demoBanner(db) {
  if (db.mode !== 'demo') return;
  const b = document.createElement('div');
  b.className = 'demo-banner';
  b.innerHTML =
    '<b>Demo mode</b> — no Firebase configured. Everything syncs between tabs of <u>this browser only</u>. Add your Firebase config in <code>js/config.js</code> to play with phones.';
  document.body.prepend(b);
}

export function toast(msg, ms = 1800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
