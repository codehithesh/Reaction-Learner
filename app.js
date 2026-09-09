// ============================================================
// Reaction Learner — text-based Chrome extension app
// Session data never persists: everything lives in this page's memory.
// BYOK API keys may optionally be saved to chrome.storage.local —
// extension-private, browser-local — and are erased on request.
// Speech = native Web Speech APIs (no transcription service).
// Eval = BYOK OpenAI · Claude · Gemini · DeepSeek · Kimi · Mistral.
// ============================================================

'use strict';

const isExt = location.protocol === 'chrome-extension:';
const MAX_SLICE_CHARS = 90000;

const state = {
  sourceTitle: '',
  sourceUrl: '',
  paras: [],          // [{ text }] — reading segments
  prefixLen: [],      // cumulative chars through paragraph i
  totalChars: 0,
  markerP: -1,        // paragraph index the user has read to (T)
  pending: null,      // { markerP } — awaiting send
  reactions: [],      // { id, text, mode, atParagraph, sliceText, truncated, sliceNote, sliceChars, ts }
  evals: [],          // { reactionId, provider, model, ok, error, result, raw }
  provider: 'openai',
  reactionsOpen: true,  // right-side reactions panel visibility
  panelW: 0,           // desktop reactions panel width in px
  busyEval: false,
  voiceTyped: false,  // reaction text came from the mic
  listening: false,
  recBase: '',
  tts: { active: false, paused: false, idx: -1, utter: null },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  toast: $('toast'),
  btnSettings: $('btn-settings'),
  exportSelect: $('export-select'),
  btnSource: $('btn-source'),
  readPos: $('read-pos'), btnReact: $('btn-react'),
  voiceSelect: $('voice-select'), rateSelect: $('rate-select'),
  btnRead: $('btn-read'), btnPause: $('btn-pause'), btnStop: $('btn-stop'),
  reading: $('reading'),
  reactions: $('reactions'), reactHint: $('react-hint'),
  reactText: $('react-text'), btnMic: $('btn-mic'), btnSend: $('btn-send'),
  // mobile reactions overlay
  reactionsCol: $('reactions-col'), btnReactions: $('btn-reactions'),
  btnCloseReactions: $('btn-close-reactions'), resizer: $('reactions-resizer'),
  // modals
  sourceModal: $('source-modal'), settingsModal: $('settings-modal'),
  pasteText: $('paste-text'), loadPaste: $('load-paste'),
  themeSystem: $('theme-system'), themeLight: $('theme-light'), themeDark: $('theme-dark'),
  providerList: $('provider-list'),
  apiError: $('api-error'),
  btnForgetKeys: $('btn-forget-keys'),
};

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Toast messages — bottom-right, auto-hide after a few seconds.
let toastTimer = null;
function setStatus(msg, kind) {
  els.toast.textContent = msg || '';
  els.toast.className = 'toast' + (kind === 'error' ? ' error' : kind === 'success' ? ' success' : '');
  if (!msg) { els.toast.classList.add('hidden'); return; }
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), kind === 'error' ? 6000 : 3200);
}
function setApiError(msg) { els.apiError.textContent = msg || ''; }
function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function fmtPct(f) { return Math.round(f * 100) + '%'; }
function slug(s) {
  return (s || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';
}
function scrollBottom(el) { el.scrollTop = el.scrollHeight; }

// ============================================================
// MODALS (generic)
// ============================================================
function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const overlay = document.getElementById(btn.dataset.close);
    if (overlay) closeModal(overlay);
  });
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((ov) => closeModal(ov));
    if (els.reactionsCol.classList.contains('open')) closeReactions();
  }
});

// ---------- reactions panel: collapsible (FAB toggle), resizable on desktop ----------
function setReactionsOpen(open) {
  state.reactionsOpen = open;
  document.body.classList.toggle('reactions-closed', !open);
  els.reactionsCol.classList.toggle('open', open);
  if (open) {
    scrollBottom(els.reactions);
  } else if (recognition && state.listening) {
    recognition.stop();
    endListening();
  }
}
function openReactions() { setReactionsOpen(true); }
function closeReactions() { setReactionsOpen(false); }
function toggleReactions() { setReactionsOpen(!state.reactionsOpen); }
els.btnReactions.addEventListener('click', toggleReactions);
els.btnCloseReactions.addEventListener('click', closeReactions);

// drag the divider between reader and reactions to resize the panel
function clampPanelW(w) {
  const maxW = Math.round(window.innerWidth * 0.7);
  return Math.min(Math.max(Math.round(w), 280), maxW);
}
function applyPanelW(w) {
  state.panelW = clampPanelW(w);
  document.documentElement.style.setProperty('--panel-w', state.panelW + 'px');
}
let dragW = null;
function onResizeMove(e) {
  if (!dragW) return;
  applyPanelW(dragW.startW + (dragW.startX - e.clientX));
}
function onResizeUp() {
  dragW = null;
  document.body.classList.remove('reactions-resizing');
  document.removeEventListener('pointermove', onResizeMove);
}
els.resizer.addEventListener('pointerdown', (e) => {
  if (window.innerWidth <= 1000) return;
  e.preventDefault();
  dragW = { startX: e.clientX, startW: state.panelW || 400 };
  document.body.classList.add('reactions-resizing');
  document.addEventListener('pointermove', onResizeMove);
  document.addEventListener('pointerup', onResizeUp, { once: true });
});

function initReactionsPanel() {
  if (window.innerWidth > 1000) {
    // desktop: panel open by default, width ~38% of the window
    applyPanelW(Math.min(Math.max(Math.round(window.innerWidth * 0.38), 360), 560));
  } else {
    // mobile: collapsed — the FAB opens the full-screen sheet
    setReactionsOpen(false);
  }
}
window.addEventListener('resize', () => {
  if (window.innerWidth <= 1000) {
    if (state.reactionsOpen) setReactionsOpen(false); // side panel doesn't exist here
  } else {
    if (!state.panelW) initReactionsPanel();
  }
});

// ============================================================
// SETTINGS: theme + provider cards
// ============================================================
// Appearance: follow the OS, or force light / dark. The choice is in-memory.
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
let themePref = 'system'; // 'system' | 'light' | 'dark'
function effectiveTheme() {
  if (themePref === 'light') return 'light';
  if (themePref === 'dark') return 'dark';
  return darkMQ.matches ? 'dark' : 'light';
}
function renderTheme() {
  document.documentElement.setAttribute('data-theme', effectiveTheme());
  els.themeSystem.classList.toggle('active', themePref === 'system');
  els.themeLight.classList.toggle('active', themePref === 'light');
  els.themeDark.classList.toggle('active', themePref === 'dark');
}
function setThemePref(p) {
  themePref = p;
  renderTheme();
}
els.btnSettings.addEventListener('click', () => openModal(els.settingsModal));
els.themeSystem.addEventListener('click', () => setThemePref('system'));
els.themeLight.addEventListener('click', () => setThemePref('light'));
els.themeDark.addEventListener('click', () => setThemePref('dark'));
if (darkMQ.addEventListener) darkMQ.addEventListener('change', renderTheme); // live OS switch

// ============================================================
// PROVIDERS — BYOK evaluation backends
// ============================================================
// style 'chat'     = OpenAI-compatible /chat/completions (Bearer auth)
// style 'messages' = Anthropic Messages API (anthropic-version header)
// json / temp      = whether the API accepts response_format + temperature;
//                    callChat retries bare if a model rejects either.
const PROVIDERS = [
  {
    id: 'openai', label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'gpt-4o',
    noTemp: (m) => /^o[134]/.test(m),
    hint: 'Reasoning models fall back to gpt-4o automatically if your key rejects them.',
    ph: 'sk-...',
    models: [
      { v: 'o3-mini', l: 'o3-mini (reasoning)' },
      { v: 'o4-mini', l: 'o4-mini (reasoning)' },
      { v: 'gpt-4o', l: 'gpt-4o (fast)' },
    ],
  },
  {
    id: 'anthropic', label: 'Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    style: 'messages', json: false, temp: false,
    fallback: 'claude-sonnet-5',
    def: 'claude-sonnet-5',
    hint: 'Key from console.anthropic.com — JSON is requested inside the prompt.',
    ph: 'sk-ant-...',
    models: [
      { v: 'claude-fable-5-1', l: 'Fable 5.1 — deepest reasoning' },
      { v: 'claude-opus-5', l: 'Opus 5 — strongest overall' },
      { v: 'claude-sonnet-5', l: 'Sonnet 5 — speed + intelligence' },
      { v: 'claude-haiku-4-5-20251001', l: 'Haiku 4.5 — fastest' },
    ],
  },
  {
    id: 'google', label: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    style: 'chat', json: true, temp: false,
    fallback: 'gemini-2.5-flash',
    hint: 'API key from Google AI Studio (aistudio.google.com/apikey).',
    ph: 'AIza...',
    models: [
      { v: 'gemini-3.8-flash', l: 'Gemini 3.8 Flash' },
      { v: 'gemini-3.1-pro', l: 'Gemini 3.1 Pro' },
      { v: 'gemini-3-flash', l: 'Gemini 3 Flash' },
      { v: 'gemini-2.5-flash', l: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'deepseek', label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'deepseek-chat',
    noTemp: (m) => m === 'deepseek-reasoner',
    noJson: (m) => m === 'deepseek-reasoner',
    hint: 'OpenAI-compatible reasoning API. Reasoner falls back to deepseek-chat.',
    ph: 'sk-...',
    models: [
      { v: 'deepseek-reasoner', l: 'deepseek-reasoner (R1)' },
      { v: 'deepseek-chat', l: 'deepseek-chat (V3)' },
    ],
  },
  {
    id: 'moonshot', label: 'Kimi',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'kimi-k2.6',
    noTemp: (m) => m === 'kimi-k3',
    hint: 'International endpoint (api.moonshot.ai).',
    ph: 'sk-...',
    models: [
      { v: 'kimi-k2.6', l: 'Kimi K2.6 (reasoning)' },
      { v: 'kimi-k3', l: 'Kimi K3 (1M context)' },
    ],
  },
  {
    id: 'mistral', label: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'mistral-small-latest',
    hint: 'Key from console.mistral.ai.',
    ph: '...',
    models: [
      { v: 'mistral-large-latest', l: 'Mistral Large' },
      { v: 'mistral-small-latest', l: 'Mistral Small (fast)' },
    ],
  },
];
const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

function providerInput(id) { return document.getElementById('key-' + id); }
function providerModel(id) { return document.getElementById('model-' + id); }

function renderProviderCards() {
  els.providerList.innerHTML = PROVIDERS.map((p) => {
    const def = p.def || p.models[0].v;
    const opts = p.models.map((m) =>
      `<option value="${m.v}"${m.v === def ? ' selected' : ''}>${m.l}</option>`
    ).join('');
    return `
      <div class="provider-card${p.id === state.provider ? ' active' : ''}" data-provider="${p.id}">
        <div class="pc-head">
          <span class="pc-radio"></span>
          <span class="pc-name">${p.label}</span>
          <span class="pc-models">${p.models.map((m) => m.l).join(' · ')}</span>
        </div>
        <label for="key-${p.id}">API key</label>
        <input type="password" id="key-${p.id}" placeholder="${p.ph || 'Paste your API key'}" autocomplete="off" spellcheck="false">
        <label for="model-${p.id}">Model</label>
        <select id="model-${p.id}">${opts}</select>
        ${p.hint ? `<p class="hint">${p.hint}</p>` : ''}
      </div>`;
  }).join('\n');
}

// Pick a provider: click its header, or focus its key field / model list.
els.settingsModal.addEventListener('click', (e) => {
  const head = e.target.closest('.pc-head');
  if (head) setProvider(head.closest('.provider-card').dataset.provider);
});
els.settingsModal.addEventListener('focusin', (e) => {
  const card = e.target.closest('.provider-card');
  if (card && e.target.matches('input, select')) setProvider(card.dataset.provider);
});
els.settingsModal.addEventListener('input', (e) => {
  if (e.target.matches('input[type="password"]')) {
    setApiError('');
    updateForgetBtn();
    scheduleKeySave();
  }
});

function setProvider(prov) {
  state.provider = prov;
  document.querySelectorAll('.provider-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.provider === prov);
  });
  setApiError('');
}

function activeProvider() {
  const cfg = PROVIDER_MAP[state.provider];
  return {
    name: cfg.id,
    label: cfg.label,
    key: providerInput(cfg.id).value.trim(),
    model: providerModel(cfg.id).value,
  };
}

// ============================================================
// KEY PERSISTENCE — extension-private chrome.storage.local
// ============================================================
// Keys you type are saved here (debounced), survive browser restarts,
// and are deleted completely by “Forget saved keys”. Not encrypted on
// purpose: this storage area is already private to the extension — a
// stored encryption key would protect against nothing extra.
let saveKeysTimer = null;

function updateForgetBtn() {
  const anyTyped = PROVIDERS.some((p) => {
    const el = providerInput(p.id);
    return !!el && !!el.value.trim();
  });
  els.btnForgetKeys.disabled = !anyTyped;
}

function scheduleKeySave() {
  if (!isExt) return;
  clearTimeout(saveKeysTimer);
  saveKeysTimer = setTimeout(persistKeys, 400);
}

async function persistKeys() {
  if (!isExt) return;
  const keys = {};
  for (const p of PROVIDERS) {
    const v = providerInput(p.id).value.trim();
    if (v) keys[p.id] = v;
  }
  try {
    if (Object.keys(keys).length) await chrome.storage.local.set({ rlApiKeys: keys });
    else await chrome.storage.local.remove('rlApiKeys'); // emptied → gone for good
  } catch { /* storage unavailable — stay in-memory only */ }
}

async function forgetKeys() {
  clearTimeout(saveKeysTimer);
  for (const p of PROVIDERS) providerInput(p.id).value = '';
  setApiError('');
  updateForgetBtn();
  if (isExt) {
    try { await chrome.storage.local.remove('rlApiKeys'); } catch { /* ignore */ }
  }
  setStatus('Saved API keys erased from this browser', 'success');
}
els.btnForgetKeys.addEventListener('click', forgetKeys);

async function loadSavedKeys() {
  if (!isExt) return;
  try {
    const { rlApiKeys } = await chrome.storage.local.get('rlApiKeys');
    if (!rlApiKeys) return;
    let any = false;
    for (const p of PROVIDERS) {
      if (rlApiKeys[p.id]) { providerInput(p.id).value = rlApiKeys[p.id]; any = true; }
    }
    if (any) {
      updateForgetBtn();
      setStatus('Saved API keys restored — open Settings to review or erase them', 'success');
    }
  } catch { /* ignore */ }
}

// ============================================================
// SOURCE: paste (modal) or grabbed page text
// ============================================================
els.btnSource.addEventListener('click', () => {
  openModal(els.sourceModal);
  els.pasteText.focus();
});

els.loadPaste.addEventListener('click', () => {
  const text = els.pasteText.value.trim();
  if (!text) { setStatus('Paste some text first', 'error'); return; }
  loadSource(text, 'Pasted text', '');
  closeModal(els.sourceModal);
});

async function consumePendingGrab() {
  if (!isExt) return;
  const tok = new URLSearchParams(location.search).get('grab');
  if (!tok) return;
  try {
    const { pendingGrab } = await chrome.storage.session.get('pendingGrab');
    if (pendingGrab && pendingGrab.token === tok) {
      chrome.storage.session.remove('pendingGrab');
      if (pendingGrab.text && pendingGrab.text.trim()) {
        loadSource(pendingGrab.text, pendingGrab.title || '', pendingGrab.url || '');
        setStatus('Loaded text from the page you opened this from', 'success');
      } else {
        setStatus('Nothing readable was found on that page — use “Add Text” to paste instead.', 'error');
      }
    } else if (pendingGrab) {
      chrome.storage.session.remove('pendingGrab'); // stale token
    }
  } catch { /* non-extension context — ignore */ }
}

function loadSource(text, title, url) {
  stopTTS();
  state.sourceTitle = title || '';
  state.sourceUrl = url || '';
  state.paras = segmentText(text);
  state.totalChars = text.length;
  state.markerP = -1;
  state.pending = null;
  state.voiceTyped = false;
  els.reactText.value = '';

  state.prefixLen = [];
  let acc = 0;
  for (const p of state.paras) { acc += p.text.length + 2; state.prefixLen.push(acc); }

  renderReading();
  const who = state.sourceTitle && state.sourceTitle !== 'Pasted text' ? `“${state.sourceTitle}”` : 'text';
  setStatus(`Loaded ${who}: ${state.paras.length} paragraphs, ${fmtCount(state.totalChars)} chars`, 'success');
  els.pasteText.value = '';
  updateReadPos();
  updateControls();
}

function segmentText(text) {
  const clean = text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
  // Preserve the author's structure: every line break starts a new paragraph,
  // so single-newline-separated paragraphs are never merged into one wall of text.
  const lines = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (line.length <= 2200) { out.push({ text: line }); continue; }
    // Exceptionally long single-line paragraphs are split at sentence boundaries
    // so marking and read-aloud stay reliable.
    const sentences = line.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [line];
    let cur = '';
    for (const s of sentences) {
      const piece = s.trim();
      if (!piece) continue;
      if ((cur + ' ' + piece).length > 1600 && cur) { out.push({ text: cur }); cur = piece; }
      else cur = cur ? cur + ' ' + piece : piece;
    }
    if (cur) out.push({ text: cur });
  }
  return out.length ? out : [{ text: clean }];
}

// ---------- reading pane + marker ----------
function renderReading() {
  els.reading.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.paras.forEach((p, i) => {
    const el = document.createElement('p');
    el.className = 'para';
    el.dataset.p = String(i);
    el.textContent = p.text;
    frag.appendChild(el);
  });
  els.reading.appendChild(frag);
}

els.reading.addEventListener('click', (e) => {
  const pEl = e.target.closest('p.para');
  if (!pEl) return;
  stopTTS();
  setMarker(parseInt(pEl.dataset.p, 10));
});

function setMarker(i) {
  state.markerP = i;
  if (state.pending) state.pending.markerP = i;
  renderReadingState();
  updateReadPos();
  updateControls();
}

function renderReadingState() {
  const readingNow = state.tts.active && state.tts.idx >= 0 ? state.tts.idx : -1;
  els.reading.querySelectorAll('p.para').forEach((el) => {
    const i = parseInt(el.dataset.p, 10);
    el.classList.toggle('before', i < state.markerP);
    el.classList.toggle('marker', i === state.markerP);
    el.classList.toggle('after', i > state.markerP);
    el.classList.toggle('reading-now', i === readingNow);
  });
}

function updateReadPos() {
  if (!state.paras.length) { els.readPos.textContent = 'No text loaded'; return; }
  if (state.markerP < 0) {
    els.readPos.textContent = `0 / ${state.paras.length} paragraphs — click a paragraph to set your spot`;
    return;
  }
  const chars = state.prefixLen[state.markerP] || 0;
  const pct = state.totalChars ? chars / state.totalChars : 0;
  els.readPos.textContent =
    `At ¶ ${state.markerP + 1} of ${state.paras.length} · ${fmtCount(chars)} chars · ${fmtPct(pct)} of text`;
}

// ============================================================
// NATIVE TTS — read aloud, paragraph by paragraph (no API)
// ============================================================
const synth = window.speechSynthesis || null;

function populateVoices() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices.length) return;
  const cur = els.voiceSelect.value;
  els.voiceSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'System default';
  els.voiceSelect.appendChild(def);
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    els.voiceSelect.appendChild(o);
  }
  if (cur) els.voiceSelect.value = cur;
}
if (synth) {
  populateVoices();
  synth.addEventListener('voiceschanged', populateVoices);
} else {
  els.btnRead.disabled = els.btnPause.disabled = els.btnStop.disabled = true;
  els.voiceSelect.disabled = els.rateSelect.disabled = true;
}

function activeVoice() {
  if (!synth) return null;
  const name = els.voiceSelect.value;
  if (!name) return null;
  return synth.getVoices().find((v) => v.name === name) || null;
}

// pause button keeps its icon while the label swaps between Pause / Resume
function setPauseBtn(label) {
  const ic = label === 'Resume' ? 'play' : 'pause';
  els.btnPause.innerHTML = `<span class="ic ic-${ic}" aria-hidden="true"></span>${label}`;
}

function readAloudFrom(startP) {
  if (!synth || !state.paras.length) return;
  if (startP < 0 || startP >= state.paras.length) {
    setStatus('Nothing left to read — mark an earlier paragraph to re-read', 'error');
    return;
  }
  stopTTS();
  state.tts.active = true;
  state.tts.paused = false;
  state.tts.idx = startP;
  els.btnPause.disabled = false;
  els.btnStop.disabled = false;
  setPauseBtn('Pause');
  setStatus('Reading aloud — native speech, nothing uploaded');
  renderReadingState();
  speakNext();
}

function speakNext() {
  if (!state.tts.active) return;
  const i = state.tts.idx;
  if (i >= state.paras.length) {
    stopTTS(true);
    setStatus('Read-aloud finished', 'success');
    return;
  }
  const utter = new SpeechSynthesisUtterance(state.paras[i].text);
  const v = activeVoice();
  if (v) utter.voice = v;
  utter.rate = parseFloat(els.rateSelect.value) || 1;
  state.tts.utter = utter;
  utter.onend = () => {
    if (!state.tts.active) return;
    setMarker(i);                      // this paragraph is now fully read
    if (i + 1 < state.paras.length) {
      state.tts.idx = i + 1;
      speakNext();
    } else {
      stopTTS(true);
      setStatus('Read-aloud finished', 'success');
    }
  };
  utter.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return; // cancelled by us
    stopTTS();
    setStatus('Read-aloud error: ' + (e.error || 'unknown'), 'error');
  };
  renderReadingState();
  synth.speak(utter);
}

function stopTTS(finished) {
  if (synth) {
    try { synth.cancel(); } catch { /* noop */ }
  }
  const wasActive = state.tts.active;
  state.tts.active = false;
  state.tts.paused = false;
  state.tts.idx = -1;
  state.tts.utter = null;
  setPauseBtn('Pause');
  els.btnPause.disabled = true;
  els.btnStop.disabled = true;
  if (wasActive && !finished) setStatus('Stopped reading');
  if (state.paras.length) renderReadingState();
}

els.btnRead.addEventListener('click', () => {
  if (!synth || !state.paras.length) { setStatus('Load text first', 'error'); return; }
  // Read from the selected paragraph itself — not the one after it.
  if (state.markerP < 0) {
    setMarker(0);
    readAloudFrom(0);
  } else {
    readAloudFrom(state.markerP);
  }
});

els.btnPause.addEventListener('click', () => {
  if (!synth || !state.tts.active) return;
  if (state.tts.paused) {
    synth.resume();
    state.tts.paused = false;
    setPauseBtn('Pause');
    setStatus('Reading…');
  } else {
    synth.pause();
    state.tts.paused = true;
    setPauseBtn('Resume');
    setStatus('Paused — react here if you like');
  }
});
els.btnStop.addEventListener('click', () => stopTTS(false));

// ============================================================
// NATIVE STT — voice reactions (no API)
// ============================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recognition = null;
if (SR) {
  recognition = new SR();
  recognition.lang = (navigator.language || 'en-US').replace('_', '-');
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    let t = '';
    for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
    state.voiceTyped = true;
    els.reactText.value = (state.recBase ? state.recBase + ' ' : '') + t.trim();
    updateControls();
  };
  recognition.onend = () => { if (state.listening) endListening(); };
  recognition.onerror = (e) => {
    endListening();
    setStatus('Mic error: ' + (e.error || 'unknown'), 'error');
  };
} else {
  els.btnMic.disabled = true;
  els.btnMic.title = 'Speech recognition is not supported in this browser';
}

function toggleListening() {
  if (!recognition) return;
  if (state.listening) {
    recognition.stop();
    endListening();
    return;
  }
  if (state.busyEval || !state.pending) return;
  state.recBase = els.reactText.value.trim();
  state.listening = true;
  els.btnMic.classList.add('listening');
  els.btnMic.innerHTML = '<span class="record-dot"></span>Stop mic';
  setStatus('Listening… speak your reaction (native speech-to-text)');
  try { recognition.start(); }
  catch { endListening(); setStatus('Mic is already busy — try again', 'error'); }
}
function endListening() {
  state.listening = false;
  els.btnMic.classList.remove('listening');
  els.btnMic.innerHTML = '<span class="record-dot"></span>Mic';
}
els.btnMic.addEventListener('click', toggleListening);

// ============================================================
// REACTION FLOW
// ============================================================
els.btnReact.addEventListener('click', () => {
  if (state.paras.length === 0) { setStatus('Load a source text first', 'error'); return; }
  if (state.markerP < 0) { setStatus('Click a paragraph to set your spot first', 'error'); return; }
  if (state.busyEval) { setStatus('Wait for the current evaluation to finish', 'error'); return; }
  stopTTS();
  state.pending = { markerP: state.markerP };
  state.voiceTyped = false;
  updateControls();
  els.reactText.focus();
  setStatus(`Reaction position locked at ¶ ${state.markerP + 1} — type or speak`, 'success');
});

els.reactText.addEventListener('input', updateControls);
els.reactText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.btnSend.click(); }
});

els.btnSend.addEventListener('click', async () => {
  if (!state.pending) return;
  const text = els.reactText.value.trim();
  if (!text) { setStatus('Write or speak a reaction first', 'error'); return; }
  if (state.busyEval) { setStatus('Wait for the current evaluation to finish', 'error'); return; }

  const prov = activeProvider();
  if (!prov.key) {
    setApiError(`Enter your ${prov.label} API key to evaluate`);
    setStatus('API key required for evaluation — open Settings', 'error');
    return;
  }

  stopTTS();
  if (recognition && state.listening) { recognition.stop(); endListening(); }

  const markerP = state.pending.markerP;
  const sliceParts = state.paras.slice(0, markerP + 1).map((p) => p.text);
  let sliceText = sliceParts.join('\n\n');
  let truncated = false;
  let sliceNote = '';
  if (sliceText.length > MAX_SLICE_CHARS) {
    sliceText = sliceText.slice(-MAX_SLICE_CHARS);
    truncated = true;
    sliceNote = `[Note: the source is longer than the context budget, so only the last ${fmtCount(MAX_SLICE_CHARS)} chars before your marker were sent.]`;
  }

  const reaction = {
    id: 'r' + (state.reactions.length + 1),
    text,
    mode: state.voiceTyped ? 'voice' : 'text',
    atParagraph: markerP,
    sliceText,
    sliceNote,
    truncated,
    sliceChars: sliceText.length,
    ts: new Date().toISOString(),
  };

  state.pending = null;
  state.voiceTyped = false;
  els.reactText.value = '';
  state.reactions.push(reaction);
  renderReaction(reaction);
  updateControls();
  await runEvaluation(reaction, prov);
});

function updateControls() {
  const hasSource = state.paras.length > 0;
  const canReact = hasSource && state.markerP >= 0 && !state.busyEval;
  els.btnReact.disabled = !canReact;

  const canCompose = !!state.pending && !state.busyEval && hasSource;
  els.reactText.disabled = !canCompose;
  els.btnMic.disabled = !canCompose || !recognition;
  els.btnSend.disabled = !canCompose || !els.reactText.value.trim();

  els.exportSelect.disabled = state.reactions.length === 0;

  if (state.pending) {
    els.reactHint.textContent = `Reacting at ¶ ${state.pending.markerP + 1} — everything up to it is the evaluated context.`;
  } else if (state.busyEval) {
    els.reactHint.textContent = 'Evaluating your reaction…';
  } else {
    els.reactHint.textContent = 'Click a paragraph to set your spot, then press "React here."';
  }
}

// ============================================================
// EVALUATION — BYOK chat completions (multi-provider)
// ============================================================
async function callChat(prov, model, messages) {
  const cfg = PROVIDER_MAP[prov.name];
  const headers = { 'content-type': 'application/json' };

  // ---- Anthropic Messages API (different wire format) ----
  if (cfg.style === 'messages') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const conv = messages.filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const call = async (m) => {
      const resp = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          'authorization': 'Bearer ' + prov.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: m,
          max_tokens: 8192,
          ...(system ? { system } : {}),
          messages: conv,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        const err = new Error(`${cfg.label} ${resp.status}: ${txt.slice(0, 400)}`);
        err.status = resp.status; err.body = txt;
        throw err;
      }
      const data = await resp.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text };
    };
    try { return await call(model); }
    catch (firstErr) {
      if (firstErr.status === 400 && cfg.fallback && cfg.fallback !== model) {
        try { return await call(cfg.fallback); } catch { /* keep original error */ }
      }
      throw firstErr;
    }
  }

  // ---- OpenAI-compatible chat completions ----
  const wantsJson = !!cfg.json && !(cfg.noJson ? cfg.noJson(model) : false);
  const wantsTemp = !!cfg.temp && !(cfg.noTemp ? cfg.noTemp(model) : false);
  const attempt = async (m, jsonFmt, temp) => {
    const body = {
      model: m,
      messages,
      ...(temp ? { temperature: 0.2 } : {}),
      ...(jsonFmt ? { response_format: { type: 'json_object' } } : {}),
    };
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { ...headers, 'authorization': 'Bearer ' + prov.key },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      const err = new Error(`${cfg.label} ${resp.status}: ${txt.slice(0, 400)}`);
      err.status = resp.status; err.body = txt;
      throw err;
    }
    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message)
      ? (data.choices[0].message.content || '')
      : '';
    return { text };
  };
  try {
    return await attempt(model, wantsJson, wantsTemp);
  } catch (firstErr) {
    let e = firstErr;
    // A param (temperature / response_format) this model rejects → retry bare.
    if (e.status === 400 && (wantsJson || wantsTemp)) {
      try { return await attempt(model, false, false); } catch (e2) { e = e2; }
    }
    // A model your account can't use → retry the provider's safe fallback, bare.
    if (e.status === 400 && cfg.fallback && cfg.fallback !== model) {
      try { return await attempt(cfg.fallback, false, false); } catch { /* keep original error */ }
    }
    throw e;
  }
}

function parseJsonLoose(text) {
  if (!text) throw new Error('empty model response');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch { /* fall through */ }
  }
  throw new Error('model returned non-JSON output');
}

const DIM_LABELS = [
  ['accuracy', 'Accuracy'],
  ['understanding', 'Understanding'],
  ['coverage', 'Coverage'],
  ['unsupported_inference', 'Unsupported inference'],
  ['incorrect_claims', 'Incorrect claims'],
  ['missed_points', 'Missed points'],
  ['overall_score', 'Overall'],
];
const DIM_GUIDES = [
  ['accuracy', 'does the reaction correctly reflect the source?'],
  ['understanding', 'genuine comprehension vs mere repetition?'],
  ['coverage', 'does it cover the key points of the slice?'],
  ['unsupported_inference', 'claims not backed by the source (low score = many)'],
  ['incorrect_claims', 'statements wrong vs the source (low score = many)'],
  ['missed_points', 'important ideas omitted (low score = many)'],
  ['overall_score', 'single overall quality number'],
];

async function runEvaluation(reaction, prov) {
  state.busyEval = true;
  updateControls();

  const card = document.createElement('div');
  card.className = 'bubble ai';
  const head0 = document.createElement('div');
  head0.className = 'bubble-header';
  head0.textContent = 'Evaluation';
  const wait = document.createElement('div');
  const sp = document.createElement('span');
  sp.className = 'loader';
  wait.appendChild(sp);
  wait.appendChild(document.createTextNode(
    `Scoring with ${prov.label} (${prov.model})…`
  ));
  card.appendChild(head0);
  card.appendChild(wait);
  els.reactions.appendChild(card);
  scrollBottom(els.reactions);

  try {
    const schemaRows = DIM_GUIDES.map(([k]) => `  "${k}": {"score": 0-100, "explanation": "one sentence"}`).join(',\n');
    const schema = `{\n${schemaRows},\n  "suggested_better_summary": "concise accurate summary of the slice the learner should have produced"\n}`;

    const sliceIntro = reaction.truncated
      ? `Source text (last ${fmtCount(MAX_SLICE_CHARS)} chars before your marker — earlier text omitted):`
      : 'Source text (through the paragraph the learner reacted at):';

    const systemPrompt =
      'You are a strict but fair tutor. A learner reacted to a text passage. Compare their reaction against the source text and score it. Return ONLY valid JSON matching the requested schema — no markdown fences, no commentary, no extra text.';
    const userPrompt = `${sliceIntro}
---
${reaction.sliceText}
---
${reaction.sliceNote ? '\n' + reaction.sliceNote + '\n' : ''}
Learner's reaction:
---
${reaction.text}
---
Score every dimension on a 0-100 integer scale, higher is better, with a one-sentence explanation:
${DIM_GUIDES.map(([k, g]) => `- ${k}: ${g}`).join('\n')}
Then "suggested_better_summary": write the concise summary the learner should have been able to produce.

Return JSON exactly like:
${schema}`;

    const out = await callChat(prov, prov.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    const parsed = parseJsonLoose(out.text);
    const record = {
      reactionId: reaction.id,
      provider: prov.name,
      providerLabel: prov.label,
      model: prov.model,
      ok: true,
      result: parsed,
      raw: out.text,
    };
    state.evals.push(record);
    card.innerHTML = '';
    card.appendChild(buildEvalDOM(record, reaction));
    setStatus('Evaluation complete', 'success');
  } catch (err) {
    state.evals.push({
      reactionId: reaction.id,
      provider: prov.name,
      providerLabel: prov.label,
      model: prov.model,
      ok: false,
      error: err.message || String(err),
    });
    card.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'bubble-header';
    h.textContent = 'Evaluation failed';
    const m = document.createElement('div');
    m.style.color = 'var(--error)';
    m.textContent = err.message || String(err);
    card.appendChild(h);
    card.appendChild(m);
    setStatus('Evaluation failed: ' + (err.message || err), 'error');
  } finally {
    state.busyEval = false;
    updateControls();
  }
}

function buildEvalDOM(record, reaction) {
  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'bubble-header';
  head.textContent = `Evaluation — via ${record.providerLabel || record.provider} ${record.model}`;
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'eval-grid';
  const res = record.result || {};
  for (const [key, label] of DIM_LABELS) {
    const d = res[key];
    if (!d) continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
    const cls = score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
    const cell = document.createElement('div');
    cell.className = 'eval-cell';
    const name = document.createElement('div');
    name.className = 'name';
    name.appendChild(document.createTextNode(label));
    const badge = document.createElement('span');
    badge.className = 'score-badge ' + cls;
    badge.textContent = score + '/100';
    name.appendChild(badge);
    const exp = document.createElement('div');
    exp.className = 'exp';
    exp.textContent = d.explanation || '';
    cell.appendChild(name);
    cell.appendChild(exp);
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  if (res.suggested_better_summary) {
    const box = document.createElement('div');
    box.className = 'summary-box';
    const lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = 'Suggested better summary';
    const body = document.createElement('div');
    body.textContent = res.suggested_better_summary;
    box.appendChild(lab);
    box.appendChild(body);
    wrap.appendChild(box);
  }

  const meta = document.createElement('div');
  meta.className = 'dim-row';
  meta.textContent =
    `Context: ¶ 0–${reaction.atParagraph + 1} · ${fmtCount(reaction.sliceChars)} chars` +
    (reaction.truncated ? ' (truncated)' : '');
  wrap.appendChild(meta);
  return wrap;
}

function renderReaction(reaction) {
  const empty = els.reactions.querySelector('.empty-state');
  if (empty) empty.remove();
  const bubble = document.createElement('div');
  bubble.className = 'bubble user';
  const head = document.createElement('div');
  head.className = 'bubble-header';
  head.textContent = 'Your reaction';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = '¶ ' + (reaction.atParagraph + 1) + (reaction.mode === 'voice' ? ' · mic' : '');
  head.appendChild(tag);
  const body = document.createElement('div');
  body.textContent = reaction.text;
  bubble.appendChild(head);
  bubble.appendChild(body);
  els.reactions.appendChild(bubble);
  scrollBottom(els.reactions);
}

// ============================================================
// EXPORT — generated & downloaded in-browser
// ============================================================
function buildJson() {
  const prov = activeProvider();
  return {
    app: 'Reaction Learner',
    exported_at: new Date().toISOString(),
    evaluator: { provider: state.provider, model: prov.model },
    source: {
      title: state.sourceTitle || 'Pasted text',
      url: state.sourceUrl,
      chars: state.totalChars,
      paragraphs: state.paras.length,
      text: state.paras.map((p) => p.text).join('\n\n'),
    },
    reactions: state.reactions.map((r) => {
      const ev = state.evals.find((e) => e.reactionId === r.id);
      return {
        id: r.id,
        text: r.text,
        mode: r.mode,
        at_paragraph: r.atParagraph,
        reacted_at: r.ts,
        slice_chars: r.sliceChars,
        slice_truncated: r.truncated,
        slice_text: r.sliceText,
        evaluation: ev
          ? (ev.ok ? { provider: ev.provider, model: ev.model, ...ev.result } : { error: ev.error })
          : null,
      };
    }),
  };
}

function buildMarkdown() {
  const prov = activeProvider();
  let md = '# Reaction Learner Session\n\n';
  md += `**Source:** ${state.sourceTitle || 'Pasted text'}\n\n`;
  if (state.sourceUrl) md += `**URL:** ${state.sourceUrl}\n\n`;
  md += `**Size:** ${fmtCount(state.totalChars)} chars, ${state.paras.length} paragraphs\n\n`;
  md += `**Evaluator:** ${state.provider} / ${prov.model}\n\n`;
  md += `**Exported:** ${new Date().toISOString()}\n\n---\n\n`;
  state.reactions.forEach((r, i) => {
    const ev = state.evals.find((e) => e.reactionId === r.id);
    md += `## Reaction ${i + 1} — ¶ ${r.atParagraph + 1} (${r.mode}) — ${new Date(r.ts).toLocaleString()}\n\n`;
    md += `> ${r.text}\n\n`;
    if (ev && ev.ok) {
      for (const [key, label] of DIM_LABELS) {
        const d = ev.result[key];
        if (d) md += `- **${label}:** ${d.score}/100 — ${d.explanation || ''}\n`;
      }
      if (ev.result.suggested_better_summary) {
        md += `\n**Suggested better summary:** ${ev.result.suggested_better_summary}\n`;
      }
    } else if (ev) {
      md += `_Evaluation failed: ${ev.error}_\n`;
    }
    md += `\n---\n\n`;
  });
  return md;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.exportSelect.addEventListener('change', () => {
  const fmt = els.exportSelect.value;
  els.exportSelect.value = ''; // reset so the same choice can be picked again
  if (!fmt || !state.reactions.length) return;
  const base = `reaction-learner-${slug(state.sourceTitle)}-${Date.now()}`;
  if (fmt === 'json') {
    downloadBlob(
      new Blob([JSON.stringify(buildJson(), null, 2)], { type: 'application/json' }),
      base + '.json'
    );
  } else if (fmt === 'markdown') {
    downloadBlob(new Blob([buildMarkdown()], { type: 'text/markdown' }), base + '.md');
  }
});

// ============================================================
// init
// ============================================================
renderTheme();
renderProviderCards();
initReactionsPanel();
consumePendingGrab();
loadSavedKeys();
updateControls();
updateForgetBtn();
