// ============================================================
// SOURCE — paste (modal) or grabbed page text
// ============================================================
// Owns the reading pane: splitting the source into paragraphs, rendering them,
// responding to a paragraph click, and consuming the text the toolbar click
// handed over from the active tab.

'use strict';

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

// ---------- reading pane ----------
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

// ---------- grabbed page text (extension only) ----------
// The toolbar click stashes the page's text in chrome.storage.session and opens
// this page with a one-time token; read it, then drop it.
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

// ---------- wiring ----------
function wireReader() {
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

  els.reading.addEventListener('click', (e) => {
    const pEl = e.target.closest('p.para');
    if (!pEl) return;
    stopTTS();
    setMarker(parseInt(pEl.dataset.p, 10));
  });
}
