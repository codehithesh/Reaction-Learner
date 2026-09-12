// ============================================================
// READER — the reading pane
// ============================================================
// Owns the text once it has arrived: splitting it into paragraphs and headings,
// rendering them, and responding to a click on either.
//
// It does not acquire text. Every way a source arrives — the modal's paste tab,
// the modal's URL tab, a toolbar click — lives in js/source.js and ends by
// calling loadSource() below. This file is the single entry point for showing a
// source, and the single place the reading pane is drawn.

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
  updateReadPos();
  updateControls();
}

// A line of one to six hashes and a space is a heading — the one piece of Markdown
// the reading pane draws. The hashes are stripped from the stored text, so the
// reading pane, read-aloud and the slice sent for evaluation all see the plain
// words; only `level` remembers that it was a heading.
const HEADING_RE = /^(#{1,6})\s+(\S.*)$/;

function segmentText(text) {
  const clean = text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
  // Preserve the author's structure: every line break starts a new paragraph,
  // so single-newline-separated paragraphs are never merged into one wall of text.
  const lines = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const head = HEADING_RE.exec(line);
    if (head) { out.push({ text: head[2].trim(), level: head[1].length }); continue; }
    if (line.length <= 2200) { out.push({ text: line, level: 0 }); continue; }
    // Exceptionally long single-line paragraphs are split at sentence boundaries
    // so marking and read-aloud stay reliable.
    const sentences = line.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [line];
    let cur = '';
    for (const s of sentences) {
      const piece = s.trim();
      if (!piece) continue;
      if ((cur + ' ' + piece).length > 1600 && cur) { out.push({ text: cur, level: 0 }); cur = piece; }
      else cur = cur ? cur + ' ' + piece : piece;
    }
    if (cur) out.push({ text: cur, level: 0 });
  }
  return out.length ? out : [{ text: clean, level: 0 }];
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
    // One element per segment, heading or paragraph — but always `.para` with a
    // data-p, so the marker, click-to-mark and read-aloud treat both the same.
    const el = document.createElement(p.level ? 'h' + p.level : 'p');
    el.className = 'para';
    el.dataset.p = String(i);
    el.textContent = p.text;
    frag.appendChild(el);
  });
  els.reading.appendChild(frag);
}

// ---------- wiring ----------
function wireReader() {
  els.reading.addEventListener('click', (e) => {
    const pEl = e.target.closest('.para');
    if (!pEl) return;
    stopTTS();
    setMarker(parseInt(pEl.dataset.p, 10));
  });
}
