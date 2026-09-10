// ============================================================
// SAVE STORE — extension-private chrome.storage.local
// ============================================================
// The settings modal edits a draft (see js/settings.js); nothing reaches storage
// until you press Save. Saving remembers all of it: API keys, the chosen
// provider, the chosen model per provider, and the light/dark appearance choice.
// “Forget saved keys” erases the keys alone and leaves those preferences standing.
// Keys are not encrypted on purpose: this storage area is already private to the
// extension — a stored encryption key would protect against nothing extra.
//
// Outside the extension (a plain file:// or http:// tab) there is nowhere private
// to keep keys, so only the non-secret preferences fall back to localStorage.

'use strict';

const STORE = {
  keys: 'rlApiKeys',
  provider: 'rlProvider',
  models: 'rlModels',
  theme: 'rlTheme',
};

const THEMES = ['system', 'light', 'dark'];

function blankPrefs() {
  return { keys: {}, provider: state.provider, models: {}, theme: 'system' };
}

// Accept only what we recognise, so a hand-edited storage entry cannot break boot.
function shapePrefs(raw) {
  const p = blankPrefs();
  if (raw.keys && typeof raw.keys === 'object') {
    for (const prov of PROVIDERS) {
      const v = raw.keys[prov.id];
      if (typeof v === 'string' && v.trim()) p.keys[prov.id] = v.trim();
    }
  }
  if (PROVIDER_MAP[raw.provider]) p.provider = raw.provider;
  if (raw.models && typeof raw.models === 'object') {
    for (const prov of PROVIDERS) {
      const m = raw.models[prov.id];
      if (typeof m === 'string' && prov.models.some((x) => x.v === m)) p.models[prov.id] = m;
    }
  }
  if (THEMES.indexOf(raw.theme) >= 0) p.theme = raw.theme;
  return p;
}

async function loadPrefs() {
  let raw = {};
  if (isExt) {
    try { raw = await chrome.storage.local.get(Object.values(STORE)) || {}; } catch { raw = {}; }
  } else {
    // plain browser tab: no private storage for keys, but keep the rest
    try {
      raw = {
        [STORE.provider]: localStorage.getItem(STORE.provider) || undefined,
        [STORE.models]: JSON.parse(localStorage.getItem(STORE.models) || 'null'),
        [STORE.theme]: localStorage.getItem(STORE.theme) || undefined,
      };
    } catch { raw = {}; }
  }
  return shapePrefs({
    keys: raw[STORE.keys],
    provider: raw[STORE.provider],
    models: raw[STORE.models],
    theme: raw[STORE.theme],
  });
}

async function writePrefs(p) {
  const keys = Object.keys(p.keys).length ? p.keys : null;
  const models = Object.keys(p.models).length ? p.models : null;
  if (!isExt) {
    // nowhere private to keep keys — remember provider/model/theme for the next session
    try {
      localStorage.setItem(STORE.provider, p.provider);
      localStorage.setItem(STORE.theme, p.theme);
      if (models) localStorage.setItem(STORE.models, JSON.stringify(models));
      else localStorage.removeItem(STORE.models);
    } catch { /* ignore */ }
    return;
  }
  try {
    await chrome.storage.local.set({ [STORE.provider]: p.provider, [STORE.theme]: p.theme });
    if (models) await chrome.storage.local.set({ [STORE.models]: models });
    else await chrome.storage.local.remove(STORE.models);
    if (keys) await chrome.storage.local.set({ [STORE.keys]: keys });
    else await chrome.storage.local.remove(STORE.keys); // emptied → gone for good
  } catch { /* storage unavailable — stay in-memory only */ }
}

// Erase the saved keys from wherever they live (extension storage only).
async function eraseSavedKeys() {
  if (!isExt) return;
  try { await chrome.storage.local.remove(STORE.keys); } catch { /* ignore */ }
}
