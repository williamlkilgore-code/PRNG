/* Saves: the game's checkpoint (seed + floor + what carries between floors)
 * is kept in localStorage after every change, plus a best-floor record and
 * a few preferences. A save code is the checkpoint as base64 JSON. */
const SAVE_KEY = 'dicedelve-rpg-save-v1';
const BEST_KEY = 'dicedelve-rpg-best-v1';
const PREFS_KEY = 'dicedelve-rpg-prefs-v1';

function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
function del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }

export function loadSave() {
  try { return JSON.parse(get(SAVE_KEY) || 'null'); } catch (e) { return null; }
}
export function writeSave(cp) { if (cp) set(SAVE_KEY, JSON.stringify(cp)); }
export function clearSave() { del(SAVE_KEY); }

export function best() { return parseInt(get(BEST_KEY) || '0', 10) || 0; }
export function recordBest(floor) { if (floor > best()) set(BEST_KEY, String(floor)); }

export function loadPrefs() {
  try { return Object.assign({ tutorial: true, speed: 'normal' }, JSON.parse(get(PREFS_KEY) || '{}')); }
  catch (e) { return { tutorial: true, speed: 'normal' }; }
}
export function savePrefs(p) { set(PREFS_KEY, JSON.stringify(p)); }

export function encodeCode(cp) {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ app: 'dice-delve-rpg', save: cp }))));
}
export function decodeCode(code) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    return data && data.save ? data.save : data;
  } catch (e) { return null; }
}
