// ============================================================
// DOM plumbing — element cache, modals, toast
// ============================================================

'use strict';

const $ = (id) => document.getElementById(id);

// Filled in by cacheEls() during boot, once every pane has been mounted.
const els = {};

function cacheEls() {
  Object.assign(els, {
    toast: $('toast'),
    btnSettings: $('btn-settings'), btnSaveSettings: $('btn-save-settings'), btnCloseSettings: $('btn-close-settings'),
    exportMenu: $('export-menu'), btnExport: $('btn-export'),
    btnSource: $('btn-source'),
    readPos: $('read-pos'), btnReact: $('btn-react'),
    voiceSelect: $('voice-select'), rateSelect: $('rate-select'),
    btnRead: $('btn-read'), btnPause: $('btn-pause'), btnStop: $('btn-stop'),
    reading: $('reading'),
    reactions: $('reactions'), reactHint: $('react-hint'),
    reactText: $('react-text'), btnMic: $('btn-mic'), btnSend: $('btn-send'),
    // full-screen reactions sheet
    reactionsCol: $('reactions-col'), btnReactions: $('btn-reactions'),
    btnCloseReactions: $('btn-close-reactions'),
    // modals
    sourceModal: $('source-modal'), settingsModal: $('settings-modal'),
    pasteText: $('paste-text'), loadPaste: $('load-paste'),
    themeSystem: $('theme-system'), themeLight: $('theme-light'), themeDark: $('theme-dark'),
    providerList: $('provider-list'),
    apiError: $('api-error'),
    btnForgetKeys: $('btn-forget-keys'),
  });
}

// ---------- modals (generic) ----------
function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

function wireModals() {
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const overlay = document.getElementById(btn.dataset.close);
      if (overlay) closeModal(overlay);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
  });
}

// ---------- toast ----------
// Bottom-right, auto-hide after a few seconds.
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

function scrollBottom(el) { el.scrollTop = el.scrollHeight; }
