// ============================================================
// READER — the reading pane
// ============================================================
// Owns the text once it has arrived: turning it into segments, drawing them, and
// responding to a click on one.
//
// It does not acquire text. Every way a source arrives — the modal's paste tab,
// the modal's URL tab, a toolbar click — lives in js/source.js and ends by
// calling loadSource() below. This file is the single entry point for showing a
// source, and the single place the reading pane is drawn.
//
// It does not parse either. Markdown — what a block is, what it looks like, what
// words it holds — belongs to js/markdown.js. Here a segment is just a reading
// position with a block attached, and a block is just an element to draw.

'use strict';

// `markdown` says whether the text arrived as Markdown and its structure is to be
// drawn. Both extension routes always are — background.js emits Markdown — while
// pasted text is whatever the user says it is (the paste tab's switch). Off means
// literal: every line is its own paragraph and nothing is interpreted.
function loadSource(text, title, url, markdown = true) {
  stopTTS();
  state.sourceTitle = title || '';
  state.sourceUrl = url || '';
  state.paras = segmentText(text, markdown);
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
  updateReadPos();
  updateControls();
}

// A page's <title> and its first <h1> are usually the same words with different
// punctuation — "Notes — Chapter 3" against "Notes - Chapter 3", or the title
// carrying a trailing "| Site Name". Compare them loosely so the same line is not
// printed twice.
//
// Loose enough to see past that punctuation, tight enough not to swallow a real
// heading: a partial match has to land on word boundaries and the containing
// string has to be long enough to mean something, or "Home" would match a
// heading about "Homeostasis" and drop the page's own title.
function titleRepeatsFirstHeading(title) {
  const first = state.paras.find((p) => p.level);
  if (!first) return false;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(title);
  const b = norm(first.text);
  if (!a || !b) return false;
  if (a === b) return true;
  const contains = (hay, needle) => (' ' + hay + ' ').includes(' ' + needle + ' ');
  return (a.length >= 12 && contains(b, a)) || (b.length >= 12 && contains(a, b));
}

// ---------- reading pane ----------
function renderReading() {
  els.reading.innerHTML = '';
  const frag = document.createDocumentFragment();

  // The page's own title, drawn above the text rather than inside it: it is not a
  // reading position, so it takes no paragraph index and cannot shift ¶ numbers.
  const title = (state.sourceTitle || '').trim();
  if (title && title !== 'Pasted text' && !titleRepeatsFirstHeading(title)) {
    const h = document.createElement('h1');
    h.className = 'source-title';
    h.textContent = title;
    frag.appendChild(h);
  }

  state.paras.forEach((p, i) => {
    // The block draws itself — heading, list, table, code, math or plain text —
    // and comes back as one element. `.para` and the data-p are stamped on here,
    // in the one place that knows what a reading position is, so every block type
    // is clickable, markable and readable without knowing anything about it.
    const el = mdRenderBlock(p.block);
    el.classList.add('para');
    el.dataset.p = String(i);
    frag.appendChild(el);
  });
  els.reading.appendChild(frag);
}

// ---------- wiring ----------
function wireReader() {
  els.reading.addEventListener('click', (e) => {
    // A link or an image chip inside the text is its own target: opening it must
    // not also move the reading marker.
    if (e.target.closest('a')) return;
    const pEl = e.target.closest('.para');
    if (!pEl) return;
    stopTTS();
    setMarker(parseInt(pEl.dataset.p, 10));
  });
}
