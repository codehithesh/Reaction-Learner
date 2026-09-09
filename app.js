// ============================================================
// Reaction Learner — text-based Chrome extension app
// Zero persistence: everything lives in this page's memory.
// Speech = native Web Speech APIs (no transcription service).
// Eval = BYOK OpenAI or DeepSeek reasoning model (settings modal).
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
  busyEval: false,
  voiceTyped: false,  // reaction text came from the mic
  listening: false,
  recBase: '',
  tts: { active: false, paused: false, idx: -1, utter: null },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  statusLine: $('status-line'),
  btnSettings: $('btn-settings'),
  exportJson: $('export-json'), exportMd: $('export-md'),
  btnSource: $('btn-source'), btnGrabNow: $('btn-grab-now'),
  readPos: $('read-pos'), btnReact: $('btn-react'),
  voiceSelect: $('voice-select'), rateSelect: $('rate-select'),
  btnRead: $('btn-read'), btnPause: $('btn-pause'), btnStop: $('btn-stop'),
  reading: $('reading'),
  activity: $('activity'), reactHint: $('react-hint'),
  reactText: $('react-text'), btnMic: $('btn-mic'), btnSend: $('btn-send'),
  // mobile activity overlay
  activityCol: $('activity-col'), btnActivity: $('btn-activity'),
  btnCloseActivity: $('btn-close-activity'), activityCount: $('activity-count'),
  // modals
  sourceModal: $('source-modal'), settingsModal: $('settings-modal'),
  pasteText: $('paste-text'), loadPaste: $('load-paste'),
  themeDark: $('theme-dark'), themeLight: $('theme-light'),
  keyOai: $('key-oai'), keyDs: $('key-ds'),
  modelOai: $('model-oai'), modelDs: $('model-ds'),
  apiError: $('api-error'),
};

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function setStatus(msg, kind) {
  els.statusLine.textContent = msg || '';
  els.statusLine.className = kind === 'error' ? 'error' : kind === 'success' ? 'success' : '';
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
    if (els.activityCol.classList.contains('open')) closeActivity();
  }
});

// mobile: activity collapses into a full-screen panel
function openActivity() {
  els.activityCol.classList.add('open');
  scrollBottom(els.activity);
}
function closeActivity() {
  els.activityCol.classList.remove('open');
  if (recognition && state.listening) { recognition.stop(); endListening(); }
}
els.btnActivity.addEventListener('click', openActivity);
els.btnCloseActivity.addEventListener('click', closeActivity);

// ============================================================
// SETTINGS: theme + provider cards
// ============================================================
function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  els.themeDark.classList.toggle('active', name === 'dark');
  els.themeLight.classList.toggle('active', name === 'light');
}
els.btnSettings.addEventListener('click', () => openModal(els.settingsModal));
els.themeDark.addEventListener('click', () => applyTheme('dark'));
els.themeLight.addEventListener('click', () => applyTheme('light'));

// Provider selection — stacked cards, click a card to choose it
els.settingsModal.addEventListener('click', (e) => {
  const card = e.target.closest('.provider-card');
  if (card) setProvider(card.dataset.provider);
});

function setProvider(prov) {
  state.provider = prov;
  document.querySelectorAll('.provider-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.provider === prov);
  });
  setApiError('');
}
[els.keyOai, els.keyDs].forEach((el) => el.addEventListener('input', () => setApiError('')));

function activeProvider() {
  const key = state.provider === 'openai' ? els.keyOai.value.trim() : els.keyDs.value.trim();
  const model = state.provider === 'openai' ? els.modelOai.value : els.modelDs.value;
  return { name: state.provider, key, model };
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

async function grabActiveTab() {
  if (!isExt) { setStatus('Open this as a Chrome extension to grab pages', 'error'); return; }
  setStatus('Grabbing current tab text…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:|^file:/.test(tab.url || '')) throw new Error('no web page active');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pick = (el) => (el && el.innerText ? el.innerText : '');
        const root = document.querySelector('article') || document.querySelector('main') || document.body;
        return { title: document.title || '', url: location.href || '', text: pick(root) };
      },
    });
    const r = results && results[0] && results[0].result;
    if (!r || !r.text || !r.text.trim()) throw new Error('no readable text found');
    loadSource(r.text, r.title, r.url);
  } catch (err) {
    setStatus('Could not grab: ' + (err.message || err) + ' — click the toolbar icon while on the page instead.', 'error');
  }
}
els.btnGrabNow.addEventListener('click', grabActiveTab);

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
        setStatus('Nothing readable was found on that page — use “✎ Text source” to paste instead.', 'error');
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
  const blocks = clean.split(/\n{2,}/);
  const out = [];
  for (let b of blocks) {
    b = b.replace(/\n+/g, ' ').trim();
    if (!b) continue;
    if (b.length <= 1400) { out.push({ text: b }); continue; }
    const sentences = b.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [b];
    let cur = '';
    for (const s of sentences) {
      const piece = s.trim();
      if (!piece) continue;
      if ((cur + ' ' + piece).length > 1400 && cur) { out.push({ text: cur }); cur = piece; }
      else cur = cur ? cur + ' ' + piece : piece;
    }
    if (cur) out.push({ text: cur });
  }
  return out.length ? out : [{ text: text.trim() }];
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
    els.readPos.textContent = `0 / ${state.paras.length} paragraphs read — click the paragraph you’ve read up to`;
    return;
  }
  const chars = state.prefixLen[state.markerP] || 0;
  const pct = state.totalChars ? chars / state.totalChars : 0;
  els.readPos.textContent =
    `Marked ¶ ${state.markerP + 1} of ${state.paras.length} · ${fmtCount(chars)} chars · ${fmtPct(pct)} of text`;
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
  els.btnPause.textContent = '⏸ Pause';
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
  els.btnPause.textContent = '⏸ Pause';
  els.btnPause.disabled = true;
  els.btnStop.disabled = true;
  if (wasActive && !finished) setStatus('Stopped reading');
  if (state.paras.length) renderReadingState();
}

els.btnRead.addEventListener('click', () => {
  if (!synth || !state.paras.length) { setStatus('Load text first', 'error'); return; }
  if (state.markerP < 0) {
    setMarker(0);
    readAloudFrom(0);
  } else {
    readAloudFrom(state.markerP + 1);
  }
});

els.btnPause.addEventListener('click', () => {
  if (!synth || !state.tts.active) return;
  if (state.tts.paused) {
    synth.resume();
    state.tts.paused = false;
    els.btnPause.textContent = '⏸ Pause';
    setStatus('Reading…');
  } else {
    synth.pause();
    state.tts.paused = true;
    els.btnPause.textContent = '▶ Resume';
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
  if (state.markerP < 0) { setStatus('Click the paragraph you’ve read up to first', 'error'); return; }
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
    setApiError(`Enter your ${prov.name === 'openai' ? 'OpenAI' : 'DeepSeek'} API key to evaluate`);
    setStatus('API key required for evaluation — open ⚙ Settings', 'error');
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

  els.exportJson.disabled = state.reactions.length === 0;
  els.exportMd.disabled = state.reactions.length === 0;
  els.activityCount.textContent = String(state.reactions.length);

  if (state.pending) {
    els.reactHint.textContent = `Reacting at ¶ ${state.pending.markerP + 1} — everything before it is the evaluated context.`;
  } else if (state.busyEval) {
    els.reactHint.textContent = 'Evaluating your reaction…';
  } else {
    els.reactHint.textContent = 'Click a paragraph you’ve read up to, then press “✍ React here”.';
  }
}

// ============================================================
// EVALUATION — BYOK chat completions (OpenAI / DeepSeek)
// ============================================================
const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
};
const FALLBACK_MODEL = { openai: 'gpt-4o', deepseek: 'deepseek-chat' };
const isReasoning = (m) => /^o[134]/.test(m) || m === 'deepseek-reasoner';

async function callChat(prov, model, messages, allowFallback = true) {
  const body = {
    model,
    messages,
    ...(isReasoning(model) ? {} : { temperature: 0.2 }),
    ...((prov.name === 'deepseek' && model === 'deepseek-reasoner')
      ? {}
      : { response_format: { type: 'json_object' } }),
  };
  const resp = await fetch(ENDPOINTS[prov.name], {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${prov.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    const err = new Error(`${prov.name} ${resp.status}: ${txt.slice(0, 400)}`);
    err.status = resp.status;
    err.body = txt;
    // e.g. reasoning model not on this account, or param unsupported → retry on the safe model
    if (allowFallback && resp.status === 400 && /model|response_format|temperature/i.test(txt)) {
      return callChat(prov, FALLBACK_MODEL[prov.name], messages, false);
    }
    throw err;
  }
  return resp.json();
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
    `Scoring with ${prov.name} (${prov.model})…`
  ));
  card.appendChild(head0);
  card.appendChild(wait);
  els.activity.appendChild(card);
  scrollBottom(els.activity);

  try {
    const schemaRows = DIM_GUIDES.map(([k]) => `  "${k}": {"score": 0-100, "explanation": "one sentence"}`).join(',\n');
    const schema = `{\n${schemaRows},\n  "suggested_better_summary": "concise accurate summary of the slice the learner should have produced"\n}`;

    const sliceIntro = reaction.truncated
      ? `Source text (last ${fmtCount(MAX_SLICE_CHARS)} chars before your marker — earlier text omitted):`
      : 'Source text (through the paragraph the learner reacted at):';

    const systemPrompt =
      'You are a strict but fair tutor. A learner reacted to a text passage. Compare their reaction against the source text and score it. Return ONLY valid JSON — no markdown fences, no commentary. (The word "json" is required by the API.)';
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

    const data = await callChat(prov, prov.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const parsed = parseJsonLoose(content);
    const record = {
      reactionId: reaction.id,
      provider: prov.name,
      model: prov.model,
      ok: true,
      result: parsed,
      raw: content,
    };
    state.evals.push(record);
    card.innerHTML = '';
    card.appendChild(buildEvalDOM(record, reaction));
    setStatus('Evaluation complete', 'success');
  } catch (err) {
    state.evals.push({
      reactionId: reaction.id,
      provider: prov.name,
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
  head.textContent = `Evaluation — via ${record.provider} ${record.model}`;
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
  const empty = els.activity.querySelector('.empty-state');
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
  els.activity.appendChild(bubble);
  scrollBottom(els.activity);
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

els.exportJson.addEventListener('click', () => {
  if (!state.reactions.length) return;
  downloadBlob(
    new Blob([JSON.stringify(buildJson(), null, 2)], { type: 'application/json' }),
    `reaction-learner-${slug(state.sourceTitle)}-${Date.now()}.json`
  );
});
els.exportMd.addEventListener('click', () => {
  if (!state.reactions.length) return;
  downloadBlob(
    new Blob([buildMarkdown()], { type: 'text/markdown' }),
    `reaction-learner-${slug(state.sourceTitle)}-${Date.now()}.md`
  );
});

// ============================================================
// init
// ============================================================
applyTheme('dark');
consumePendingGrab();
updateControls();
