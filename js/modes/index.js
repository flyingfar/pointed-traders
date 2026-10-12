// Game-mode registry. A mode is a self-contained module (see pointed.js / quickfire.js) that
// supplies its settings, lobby rules, validation, scoring and the few screens that differ;
// the shared core (player.js / host.js / admin.js) runs everything else.
// To add a mode: create js/modes/<id>.js exporting the same shape, then list it here.

import pointed from './pointed.js';
import quickfire from './quickfire.js';

export const MODE_LIST = [pointed, quickfire];
export const MODES = Object.fromEntries(MODE_LIST.map((m) => [m.id, m]));

/** Look up a mode by id; quizzes/games saved before modes existed are Pointed. */
export const getMode = (id) => MODES[id] || pointed;
