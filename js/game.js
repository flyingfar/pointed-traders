// Mode-independent game logic: leaderboard ranking, quiz validation, blank questions.
// Mode-specific rules (scoring, allocation, levers, timing) live in js/modes/*.js.

import { toArr } from './util.js';
import { getMode } from './modes/index.js';

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
  const mode = getMode(quiz?.mode);
  const issues = [];
  const qs = toArr(quiz?.questions);
  if (!quiz?.title?.trim()) issues.push('Missing title');
  if (!qs.length) issues.push('No questions');
  issues.push(...mode.issues(quiz));
  qs.forEach((q, i) => {
    const opts = toArr(q.options);
    const filled = opts.filter((o) => String(o || '').trim());
    if (mode.usesCategories && !String(q.category || '').trim()) issues.push(`Q${i + 1}: category`);
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
