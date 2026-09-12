// ============================================================
// MARKDOWN — the parser and the renderer
// ============================================================
// Text in, blocks out, DOM out. This is the only file that knows what Markdown
// is: js/reader.js asks for segments, draws each one's block, and that is the
// whole contract.
//
// Two rules shape everything below.
//
//  · One block, one reading position. The reading model is flat — a segment's
//    index in state.paras IS the reading position, and the marker, read-aloud,
//    the slice sent for evaluation and both exports all address the text by it.
//    So a list, a table or a code block is a single position however many
//    elements it draws, and `text` on that segment is its plain words.
//
//  · Never innerHTML. This text comes off a web page or out of the clipboard, so
//    it is not trusted: every node below is built with createElement and filled
//    with textContent. A pasted <script> tag is words here, never a script.
//
// The plain words of a segment are not produced by a second, parallel stripper
// that could drift from what is drawn — they are read back out of the very nodes
// the pane renders (nodeText below), so what is spoken and what is evaluated is
// always what is on screen.
//
// What is supported, and the two deliberate departures from CommonMark:
//
//   headings (ATX and setext) · paragraphs · hard and soft breaks · bold, italic,
//   both, strikethrough · inline code · fenced and indented code · links and
//   autolinks · images · ordered, unordered and task lists · blockquotes ·
//   pipe tables with alignment · thematic breaks · inline and display math
//   ($…$, \(…\), $$…$$, \[…\]) rendered as MathML.
//
//   · A single newline inside a paragraph stays a line break (<br>). CommonMark
//     folds it into a space. Someone pasting lecture notes means their line
//     breaks — the flat reader this replaces split on every one of them — and
//     folding them away would silently reflow their text.
//   · Raw HTML is text, not markup. Rendering it would mean innerHTML on
//     untrusted input; dropping it would silently lose content. It shows up as
//     the characters that were pasted.
//   · Images are not fetched. A remote image would report the reader's IP and
//     the fact they are reading this page to a third-party server, and the app
//     otherwise never touches the network. They draw as a labelled chip that
//     opens in a new tab when clicked.

'use strict';

// ============================================================
// 1 · TEXT → SEGMENTS
// ============================================================

function normaliseText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

// The flat model's entry point. `markdown` false is the paste pane's switch set
// the other way: literal text, every line its own paragraph, nothing interpreted.
function segmentText(text, markdown = true) {
  const clean = normaliseText(text);
  return markdown ? mdSegments(clean) : plainSegments(clean);
}

// Literal mode. This is what the app did before Markdown existed, kept exactly:
// every line break starts a paragraph, and a line too long to mark comfortably
// is split at sentence boundaries.
function plainSegments(clean) {
  const lines = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    for (const piece of splitLongLine(line)) out.push(mdSegment({ type: 'plain', src: piece }));
  }
  return out.length ? out : [mdSegment({ type: 'plain', src: clean })];
}

function mdSegments(clean) {
  const blocks = mdBlocks(clean, 0);
  return blocks.length
    ? blocks.map(mdSegment)
    : [mdSegment({ type: 'plain', src: clean })];
}

// A block becomes one segment, and the block itself rides along so the pane can
// draw it. `level` is the only thing the rest of the app knows about structure,
// and it is what lets the title dedupe and the heading styles keep working.
function mdSegment(block) {
  return {
    text: mdBlockText(block),
    level: block.type === 'heading' ? block.level : 0,
    block,
  };
}

function splitLongLine(line) {
  if (line.length <= 2200) return [line];
  // Exceptionally long single-line paragraphs are split at sentence boundaries
  // so marking and read-aloud stay reliable.
  const sentences = line.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [line];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if ((cur + ' ' + piece).length > 1600 && cur) { out.push(cur); cur = piece; }
    else cur = cur ? cur + ' ' + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

// ============================================================
// 2 · BLOCK PARSER
// ============================================================
// Line-based, and deliberately independent of headings: a document with no #
// anywhere parses exactly the same way, one block after another.

const MD_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)/;
const MD_ATX = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const MD_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const MD_QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const MD_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const MD_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const MD_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const MD_MATH_OPEN = /^ {0,3}\$\$(.*)$/;
const MD_MATH_BRACKET = /^ {0,3}\\\[(.*)$/;

function mdBlocks(text, depth) {
  if (depth > 6) return [{ type: 'plain', src: text }];
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // ---------- fenced code ----------
    const fence = MD_FENCE.exec(line);
    if (fence) {
      const open = fence[1];
      const ch = open[0];
      const body = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === ch && close[1].length >= open.length) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        lang: fence[2] || '',
        code: body.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''),
      });
      continue;
    }

    // ---------- display math ----------
    const math = MD_MATH_OPEN.exec(line) || MD_MATH_BRACKET.exec(line);
    if (math) {
      const closer = MD_MATH_OPEN.test(line) ? '$$' : '\\]';
      const body = [math[1]];
      const first = math[1].indexOf(closer);
      if (first !== -1) { body[0] = math[1].slice(0, first); i++; }
      else {
        i++;
        while (i < lines.length && lines[i].indexOf(closer) === -1) { body.push(lines[i]); i++; }
        if (i < lines.length) { body.push(lines[i].slice(0, lines[i].indexOf(closer))); i++; }
      }
      blocks.push({ type: 'math', tex: body.join('\n').trim(), display: true });
      continue;
    }

    // ---------- heading (ATX) ----------
    const atx = MD_ATX.exec(line);
    if (atx) {
      const text_ = atx[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
      if (text_) {
        blocks.push({ type: 'heading', level: atx[1].length, src: text_ });
        i++;
        continue;
      }
    }

    // ---------- heading (setext) ----------
    if (i + 1 < lines.length && MD_SETEXT.test(lines[i + 1]) && !startsBlock(lines, i)) {
      blocks.push({
        type: 'heading',
        level: lines[i + 1].trim()[0] === '=' ? 1 : 2,
        src: line.trim(),
      });
      i += 2;
      continue;
    }

    // ---------- thematic break ----------
    if (MD_HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    // ---------- blockquote ----------
    if (MD_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length) {
        const q = MD_QUOTE.exec(lines[i]);
        if (q) { inner.push(q[1]); i++; continue; }
        if (!lines[i].trim()) {
          if (i + 1 < lines.length && MD_QUOTE.test(lines[i + 1])) { inner.push(''); i++; continue; }
          break;
        }
        if (startsBlock(lines, i)) break;
        inner.push(lines[i].trim()); i++;   // lazy continuation
      }
      blocks.push({ type: 'quote', blocks: mdBlocks(inner.join('\n'), depth + 1) });
      continue;
    }

    // ---------- list ----------
    const item = MD_LIST.exec(line);
    if (item) {
      const ordered = item[2].length > 1;
      const items = [];
      while (i < lines.length) {
        const m = MD_LIST.exec(lines[i]);
        if (!m || (m[2].length > 1) !== ordered) break;

        let src = m[3];
        let checked = null;
        const task = /^\[([ xX])\][ \t]+/.exec(src);
        if (task) { checked = task[1].toLowerCase() === 'x'; src = src.slice(task[0].length); }
        i++;

        // The item's own body: lines indented under the marker, blank lines that
        // are followed by more of it, and lazily-wrapped continuations.
        const rest = [];
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            if (i + 1 < lines.length && /^ {2,}\S/.test(lines[i + 1])) { rest.push(''); i++; continue; }
            break;
          }
          if (/^ {2,}/.test(l)) {
            rest.push(l.replace(/^ {1,4}/, ''));
            i++;
            continue;
          }
          if (MD_LIST.exec(l)) break;
          if (startsBlock(lines, i)) break;
          rest.push(l.trim()); i++;           // lazy continuation
        }

        const body = [src].concat(rest).join('\n').trim();
        items.push({
          src: itemHasBlocks(body) ? '' : body,
          blocks: itemHasBlocks(body) ? mdBlocks(body, depth + 1) : null,
          checked,
        });
      }
      blocks.push({ type: 'list', ordered, start: ordered ? parseInt(item[2], 10) || 1 : 1, items });
      continue;
    }

    // ---------- pipe table ----------
    if (line.includes('|') && i + 1 < lines.length && MD_DELIM.test(lines[i + 1])) {
      const head = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map((c) => {
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitTableRow(lines[i]);
        while (cells.length < head.length) cells.push('');
        rows.push(cells.slice(0, head.length));
        i++;
      }
      blocks.push({ type: 'table', head, align, rows });
      continue;
    }

    // ---------- indented code (only after a blank line, so it cannot interrupt) ----------
    if (/^ {4}/.test(line) && (i === 0 || !lines[i - 1].trim())) {
      const body = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) {
        body.push(lines[i].replace(/^ {4}/, ''));
        i++;
      }
      blocks.push({ type: 'code', lang: '', code: body.join('\n').replace(/\s+$/, '') });
      continue;
    }

    // ---------- paragraph ----------
    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (para.length && startsBlock(lines, i)) break;
      para.push(l.trim());
      i++;
    }
    blocks.push({ type: 'para', src: para.join('\n') });
  }

  return blocks;
}

// True when the line at `i` opens a block of its own. A paragraph ends at one,
// and so does a lazily-wrapped list item or blockquote.
function startsBlock(lines, i) {
  const l = lines[i];
  if (!l || !l.trim()) return true;
  if (/^ {0,3}(`{3,}|~{3,})/.test(l)) return true;
  if (MD_ATX.test(l)) return true;
  if (MD_HR.test(l)) return true;
  if (MD_QUOTE.test(l)) return true;
  if (MD_LIST.test(l)) return true;
  if (MD_MATH_OPEN.test(l) || MD_MATH_BRACKET.test(l)) return true;
  if (l.includes('|') && i + 1 < lines.length && MD_DELIM.test(lines[i + 1])) return true;
  return false;
}

// An item that is more than a single run of prose is parsed as blocks of its own,
// so a nested list, a fenced code block or a second paragraph inside an item
// survives. Anything else is one inline string.
function itemHasBlocks(body) {
  const lines = body.split('\n');
  if (lines.length > 1) return true;
  return startsBlock(lines, 0);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

// ============================================================
// 3 · BLOCK → PLAIN WORDS
// ============================================================
// What the marker counts, the voice reads and the evaluator is sent. Never the
// only truth about a block — the renderer below draws the same content — but the
// inline half is read straight back off the rendered nodes so the two cannot
// disagree about a paragraph's words.

function mdBlockText(b) {
  if (!b) return '';
  switch (b.type) {
    case 'heading':
    case 'para':
      return mdInlineText(b.src);
    case 'plain':
      return b.src || '';
    case 'code':
      return b.code || '';
    case 'list':
      return (b.items || [])
        .map((it) => (it.blocks ? it.blocks.map(mdBlockText).join('\n') : mdInlineText(it.src)))
        .join('\n');
    case 'quote':
      return (b.blocks || []).map(mdBlockText).join('\n\n');
    case 'table':
      return [b.head].concat(b.rows || [])
        .filter(Boolean)
        .map((r) => r.map(mdInlineText).join(' | '))
        .join('\n');
    case 'math':
      return nodeText(mathNode(b.tex, false)).trim();
    case 'hr':
      return '';
    default:
      return b.src || '';
  }
}

// ============================================================
// 4 · INLINE PARSER
// ============================================================
// One pass, one regular expression, all alternatives anchored on their own
// opening delimiter. Emphasis is recursed into, which is what makes
// "**bold with *italic* inside**" come out nested rather than literal.

const RE_INLINE = new RegExp([
  '\\\\(?<esc>[\\\\`*_{}\\[\\]#+.!~$>|%&,;:-])',
  // The fence is named and closed by name: a numbered \1 would count the groups
  // declared above it and close against the wrong one.
  '(?<tick>`+)(?<code>[\\s\\S]*?)\\k<tick>',
  '!\\[(?<ialt>[^\\]]*)\\]\\(\\s*(?<isrc>[^)\\s]+)(?:\\s+"(?<ititle>[^"]*)")?\\s*\\)',
  '\\[(?<ltext>[^\\]]*)\\]\\(\\s*(?<lhref>[^)\\s]+)(?:\\s+"(?<ltitle>[^"]*)")?\\s*\\)',
  '<(?<auto>(?:https?|mailto):[^>\\s]+)>',
  '\\$\\$(?<dmath2>[\\s\\S]+?)\\$\\$',
  '\\\\\\((?<imath>[\\s\\S]+?)\\\\\\)',
  '\\$(?!\\s)(?<dmath>(?:[^$\\\\]|\\\\.)+?)(?<!\\s)\\$',
  '\\*\\*\\*(?<bem>[\\s\\S]+?)\\*\\*\\*',
  '___(?<bem2>[\\s\\S]+?)___',
  '\\*\\*(?<strong>[\\s\\S]+?)\\*\\*',
  '__(?<strong2>[\\s\\S]+?)__',
  '~~(?<del>[\\s\\S]+?)~~',
  '(?<![\\w*])\\*(?<em>[^*\\n]+?)\\*(?![\\w*])',
  '(?<![\\w_])_(?<em2>[^_\\n]+?)_(?![\\w_])',
  '\\\\\\n',
  '  \\n',
  '\\n',
].join('|'), 'g');

// A hard break (two spaces or a backslash before the newline) and a soft one both
// draw the same <br> — see the header for why a single newline is kept.
function mdInline(src, depth = 0) {
  const frag = document.createDocumentFragment();
  const text = src == null ? '' : String(src);
  if (!text) return frag;
  if (depth > 6) { frag.appendChild(document.createTextNode(text)); return frag; }

  let last = 0;
  let m;
  RE_INLINE.lastIndex = 0;
  while ((m = RE_INLINE.exec(text)) !== null) {
    // Pinned before recursing: the recursive call shares this one regex object.
    const after = RE_INLINE.lastIndex;
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    last = after;
    const g = m.groups || {};

    if (g.esc !== undefined) frag.appendChild(document.createTextNode(g.esc));
    else if (g.code !== undefined) frag.appendChild(codeSpan(g.code));
    else if (g.ialt !== undefined) frag.appendChild(imageNode(g.ialt, g.isrc));
    else if (g.ltext !== undefined) frag.appendChild(linkNode(g.ltext, g.lhref));
    else if (g.auto !== undefined) frag.appendChild(linkNode(g.auto, g.auto));
    else if (g.dmath2 !== undefined) frag.appendChild(mathNode(g.dmath2, false));
    else if (g.imath !== undefined) frag.appendChild(mathNode(g.imath, false));
    else if (g.dmath !== undefined) frag.appendChild(mathNode(g.dmath, false));
    else if (g.bem !== undefined || g.bem2 !== undefined) {
      frag.appendChild(wrapNode('strong', wrapNode('em',
        mdInline(g.bem !== undefined ? g.bem : g.bem2, depth + 1))));
    }
    else if (g.strong !== undefined || g.strong2 !== undefined)
      frag.appendChild(wrapNode('strong',
        mdInline(g.strong !== undefined ? g.strong : g.strong2, depth + 1)));
    else if (g.del !== undefined)
      frag.appendChild(wrapNode('del', mdInline(g.del, depth + 1)));
    else if (g.em !== undefined || g.em2 !== undefined)
      frag.appendChild(wrapNode('em',
        mdInline(g.em !== undefined ? g.em : g.em2, depth + 1)));
    else frag.appendChild(document.createElement('br'));

    RE_INLINE.lastIndex = after;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function wrapNode(tag, content) {
  const el = document.createElement(tag);
  el.appendChild(content);
  return el;
}

function codeSpan(code) {
  const el = document.createElement('code');
  el.textContent = code.replace(/^ | $/g, '');
  return el;
}

// Only http(s), mailto and in-page links become real links. Anything else —
// javascript:, data:, a relative path — keeps its words and loses its teeth.
function safeHref(href) {
  const s = String(href == null ? '' : href).trim();
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(s)) return 'mailto:' + s;
  return null;
}

function linkNode(label, href) {
  const url = safeHref(href);
  if (!url) {
    const span = document.createElement('span');
    span.textContent = label || href || '';
    return span;
  }
  const a = document.createElement('a');
  a.href = url;
  a.textContent = label || url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = url;
  return a;
}

// An image draws as a chip carrying its alt text: see the header for why nothing
// is fetched. Clicking it opens the file in a new tab, which is the reader's
// choice rather than a page load they never asked for.
function imageNode(alt, src) {
  const url = safeHref(src);
  const label = (alt || src || 'image').trim();
  const el = document.createElement(url ? 'a' : 'span');
  el.className = 'md-img';
  el.textContent = label;
  if (url) {
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.title = url;
  }
  return el;
}

// ============================================================
// 5 · BLOCK RENDERER
// ============================================================
// Every block returns exactly one element. js/reader.js stamps that element with
// `.para` and its data-p, which is what makes it clickable, markable and
// readable — so a block that returned two roots would break the flat model.

function mdRenderBlock(b, depth = 0) {
  if (!b) return document.createElement('p');
  if (depth > 6) {
    const p = document.createElement('p');
    p.textContent = b.src || '';
    return p;
  }
  switch (b.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level || 1));
      const h = document.createElement('h' + level);
      h.appendChild(mdInline(b.src));
      return h;
    }
    case 'para': {
      const p = document.createElement('p');
      p.appendChild(mdInline(b.src));
      return p;
    }
    case 'plain': {
      const p = document.createElement('p');
      p.textContent = b.src || '';
      return p;
    }
    case 'code':
      return renderCode(b);
    case 'list':
      return renderList(b, depth);
    case 'quote': {
      const q = document.createElement('blockquote');
      (b.blocks || []).forEach((child) => q.appendChild(mdRenderBlock(child, depth + 1)));
      return q;
    }
    case 'table':
      return renderTable(b);
    case 'math': {
      const box = document.createElement('div');
      box.className = 'md-math';
      box.appendChild(mathNode(b.tex, true));
      return box;
    }
    case 'hr':
      return document.createElement('hr');
    default: {
      const p = document.createElement('p');
      p.textContent = b.src || '';
      return p;
    }
  }
}

function renderCode(b) {
  const box = document.createElement('div');
  box.className = 'md-code';
  if (b.lang) {
    const lang = document.createElement('div');
    lang.className = 'md-lang';
    lang.textContent = b.lang;
    box.appendChild(lang);
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = b.code || '';
  pre.appendChild(code);
  box.appendChild(pre);
  return box;
}

function renderList(b, depth) {
  const list = document.createElement(b.ordered ? 'ol' : 'ul');
  if (b.ordered && b.start && b.start !== 1) list.start = b.start;
  for (const item of b.items || []) {
    const li = document.createElement('li');
    if (item.checked !== null && item.checked !== undefined) {
      li.className = 'md-task';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = box.defaultChecked = !!item.checked;   // attribute too, so it survives a re-render
      li.appendChild(box);
    }
    // A list item that starts with prose keeps that prose inline, the way a list
    // reads; only the nested block that follows it gets wrapped.
    const blocks = (item.blocks || []).slice();
    const inline = blocks.length && blocks[0].type === 'para' ? blocks.shift() : null;
    li.appendChild(inline ? mdInline(inline.src) : mdInline(item.src));
    blocks.forEach((child) => li.appendChild(mdRenderBlock(child, depth + 1)));
    list.appendChild(li);
  }
  return list;
}

function renderTable(b) {
  const wrap = document.createElement('div');
  wrap.className = 'md-table';
  const table = document.createElement('table');
  const align = b.align || [];

  const addRow = (parent, cells, tag) => {
    const tr = document.createElement('tr');
    (cells || []).forEach((cell, k) => {
      const td = document.createElement(tag);
      if (align[k] === 'center') td.style.textAlign = 'center';
      else if (align[k] === 'right') td.style.textAlign = 'right';
      td.appendChild(mdInline(cell));
      tr.appendChild(td);
    });
    parent.appendChild(tr);
  };

  const thead = document.createElement('thead');
  addRow(thead, b.head, 'th');
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  (b.rows || []).forEach((row) => addRow(tbody, row, 'td'));
  table.appendChild(tbody);

  wrap.appendChild(table);
  return wrap;
}

// ============================================================
// 6 · MATH — LaTeX subset → MathML
// ============================================================
// Rendered by the browser itself as MathML, so there is no library to vendor, no
// web font to load and nothing to fetch. The subset is the one that turns up in
// pasted notes: fractions, roots, scripts, sums and integrals, matrices, the
// greek alphabet and the usual relations and arrows. Anything unrecognised keeps
// its characters and is shown as it was written rather than dropped, and any
// input this parser cannot follow falls back to the raw TeX in a monospace chip.

const MM_NS = 'http://www.w3.org/1998/Math/MathML';

function mm(tag) {
  const el = document.createElementNS(MM_NS, tag);
  for (let i = 1; i < arguments.length; i++) {
    if (arguments[i] !== null && arguments[i] !== undefined) el.appendChild(arguments[i]);
  }
  return el;
}

function mmTok(tag, text, variant) {
  const el = mm(tag);
  el.textContent = text;
  if (variant) el.setAttribute('mathvariant', variant);
  return el;
}

const TEX_SYMBOL = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ϵ',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆',
  circ: '∘', bullet: '•', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠',
  neq: '≠', equiv: '≡', approx: '≈', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', perp: '⊥', parallel: '∥', in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  nexists: '∄', neg: '¬', lnot: '¬', land: '∧', lor: '∨', oplus: '⊕',
  otimes: '⊗', odot: '⊙', therefore: '∴', because: '∵',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  implies: '⟹', iff: '⟺', uparrow: '↑', downarrow: '↓', hookrightarrow: '↪',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', infty: '∞', partial: '∂', nabla: '∇', angle: '∠', triangle: '△',
  square: '□', cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  prime: '′', degree: '°', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  wp: '℘', surd: '√', checkmark: '✓', dagger: '†',
};

const TEX_FUNC = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'limsup',
  'liminf', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd',
  'hom', 'arg', 'mod', 'bmod', 'Pr',
]);

const TEX_SPACE = { quad: '1em', qquad: '2em', ',': '0.17em', ';': '0.28em', ':': '0.22em', '!': '-0.17em', ' ': '0.3em' };

const TEX_ACCENT = {
  hat: '^', widehat: '^', bar: '¯', overline: '¯', vec: '→', dot: '˙',
  ddot: '¨', tilde: '~', widetilde: '~', underline: '_',
};

const TEX_VARIANT = {
  mathrm: 'normal', textrm: 'normal', mathbf: 'bold', textbf: 'bold',
  mathit: 'italic', textit: 'italic', mathsf: 'sans-serif', textsf: 'sans-serif',
  mathtt: 'monospace', texttt: 'monospace', mathbb: 'normal', mathcal: 'normal',
  mathfrak: 'normal', boldsymbol: 'bold', operatorname: 'normal',
};

const TEX_TEXT_CMD = { text: 1, mbox: 1, hbox: 1, textnormal: 1 };

function texToMathML(tex, display) {
  const src = String(tex == null ? '' : tex).trim();
  if (!src || src.length > 4000) return null;
  let nodes;
  try {
    nodes = texSeq({ s: src, i: 0 }, null, 0);
  } catch {
    return null;
  }
  if (!nodes.length) return null;
  const math = mm('math');
  math.setAttribute('display', display ? 'block' : 'inline');
  math.appendChild(mm.apply(null, ['mrow'].concat(texFlatten(nodes))));
  return math;
}

function mathNode(tex, display) {
  const node = texToMathML(tex, display);
  if (node) return node;
  const span = document.createElement('span');
  span.className = 'md-tex';
  span.textContent = String(tex == null ? '' : tex).trim();
  return span;
}

function texSkip(p) {
  while (p.i < p.s.length && /[\s]/.test(p.s[p.i])) p.i++;
}

function texSep(kind) { return { __sep: kind }; }

// Stray separators outside a matrix still mean a gap in the line, so they become
// space rather than being dropped.
function texFlatten(nodes) {
  const out = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.__sep) {
      const sp = mm('mspace');
      sp.style.width = n.__sep === 'row' ? '1em' : '0.4em';
      out.push(sp);
      continue;
    }
    out.push(n);
  }
  return out;
}

function texSeq(p, close, depth) {
  const out = [];
  if (depth > 12) return out;
  for (;;) {
    texSkip(p);
    if (p.i >= p.s.length) break;
    const c = p.s[p.i];
    if (close && c === close) { p.i++; break; }
    if (c === '&') { p.i++; out.push(texSep('cell')); continue; }
    if (c === '\\' && p.s[p.i + 1] === '\\') { p.i += 2; out.push(texSep('row')); continue; }
    if (c === '}') { p.i++; continue; }
    const unit = texUnit(p, depth);
    if (!unit) break;
    if (unit.__end) break;
    out.push(texScripts(p, unit, depth));
  }
  return out;
}

function texUnit(p, depth) {
  texSkip(p);
  if (p.i >= p.s.length) return null;
  const c = p.s[p.i];
  if (c === '{') { p.i++; return texGroup(texSeq(p, '}', depth + 1)); }
  if (c === '\\') return texCommand(p, depth);
  if (/[0-9]/.test(c)) {
    const start = p.i;
    while (p.i < p.s.length && /[0-9.,]/.test(p.s[p.i])) p.i++;
    return mmTok('mn', p.s.slice(start, p.i));
  }
  p.i++;
  if (/[a-zA-Z]/.test(c)) return mmTok('mi', c);
  if (c === '~') { const sp = mm('mspace'); sp.style.width = '0.4em'; return sp; }
  return mmTok('mo', c);
}

function texGroup(nodes) {
  if (nodes.length === 1 && !nodes[0].__sep) return nodes[0];
  return mm.apply(null, ['mrow'].concat(texFlatten(nodes)));
}

function texScripts(p, base, depth) {
  let sub = null;
  let sup = null;
  for (;;) {
    texSkip(p);
    const c = p.s[p.i];
    if (c !== '^' && c !== '_') break;
    p.i++;
    const arg = texUnit(p, depth + 1) || mm('mrow');
    if (c === '^') sup = arg; else sub = arg;
  }
  if (sub && sup) return mm('msubsup', base, sub, sup);
  if (sub) return mm('msub', base, sub);
  if (sup) return mm('msup', base, sup);
  return base;
}

// One argument: a braced group, or the single token that follows.
function texArg(p, depth) {
  texSkip(p);
  if (p.s[p.i] === '{') { p.i++; return texGroup(texSeq(p, '}', depth + 1)); }
  return texUnit(p, depth) || mm('mrow');
}

// The braces' contents, verbatim — for \text{...}, where TeX is off.
function texRawArg(p) {
  texSkip(p);
  if (p.s[p.i] !== '{') return '';
  let depth = 0;
  let out = '';
  while (p.i < p.s.length) {
    const c = p.s[p.i];
    if (c === '{') { depth++; if (depth === 1) { p.i++; continue; } }
    if (c === '}') { depth--; if (depth === 0) { p.i++; break; } }
    out += c;
    p.i++;
  }
  return out;
}

function texCommand(p, depth) {
  p.i++;                                   // the backslash
  let name;
  if (/[a-zA-Z]/.test(p.s[p.i] || '')) {
    const start = p.i;
    while (p.i < p.s.length && /[a-zA-Z]/.test(p.s[p.i])) p.i++;
    name = p.s.slice(start, p.i);
  } else {
    name = p.s[p.i] || '';
    p.i++;
  }

  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    return mm('mfrac', texArg(p, depth), texArg(p, depth));
  }
  if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
    const frac = mm('mfrac', texArg(p, depth), texArg(p, depth));
    frac.setAttribute('linethickness', '0');
    return mm('mrow', mmTok('mo', '('), frac, mmTok('mo', ')'));
  }
  if (name === 'sqrt') {
    texSkip(p);
    if (p.s[p.i] === '[') {
      p.i++;
      const idx = texSeq(p, ']', depth + 1);
      return mm('mroot', texArg(p, depth), texGroup(idx));
    }
    return mm('msqrt', texArg(p, depth));
  }
  if (TEX_TEXT_CMD[name] || name === 'operatorname') {
    return mmTok('mtext', texRawArg(p), name === 'operatorname' ? 'normal' : null);
  }
  if (TEX_VARIANT[name]) {
    const inner = texArg(p, depth);
    const variant = TEX_VARIANT[name];
    if (variant === 'normal' || variant === 'bold') applyVariant(inner, variant);
    return inner;
  }
  if (TEX_ACCENT[name]) {
    const base = texArg(p, depth);
    const mark = TEX_ACCENT[name];
    return name === 'underline'
      ? mm('munder', base, mmTok('mo', mark))
      : mm('mover', base, mmTok('mo', mark));
  }
  if (name === 'begin') {
    const env = texRawArg(p).trim();
    const nodes = texSeq(p, null, depth + 1);
    return texEnvironment(env, nodes);
  }
  if (name === 'end') { texRawArg(p); return { __end: true }; }
  if (name === 'left' || name === 'right') {
    texSkip(p);
    const d = p.s[p.i] === '\\' ? (p.i++, p.s[p.i]) : p.s[p.i];
    p.i++;
    if (d === '.' || d === undefined) return mm('mrow');
    return mmTok('mo', d === '{' ? '{' : d === '}' ? '}' : d);
  }
  if (TEX_SPACE[name]) {
    const sp = mm('mspace');
    sp.style.width = TEX_SPACE[name];
    return sp;
  }
  if (TEX_SYMBOL[name]) {
    const ch = TEX_SYMBOL[name];
    return /[a-zA-Zα-ωΑ-Ω]/.test(ch) ? mmTok('mi', ch) : mmTok('mo', ch);
  }
  if (TEX_FUNC.has(name)) return mmTok('mi', name, 'normal');
  if (name === 'displaystyle' || name === 'textstyle' || name === 'scriptstyle'
    || name === 'limits' || name === 'nolimits') {
    return mm('mrow');
  }
  if (name === '%' || name === '$' || name === '&' || name === '#' || name === '_'
    || name === '{' || name === '}') {
    return mmTok('mo', name);
  }
  // Unknown: keep the word rather than swallow it.
  return mmTok('mi', name, 'normal');
}

function applyVariant(node, variant) {
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.nodeType !== 1) continue;
    if (k.tagName === 'mi' || k.tagName === 'mn' || k.tagName === 'mo') k.setAttribute('mathvariant', variant);
    else applyVariant(k, variant);
  }
}

function texEnvironment(env, nodes) {
  const rows = [];
  let cells = [[]];
  for (const n of nodes) {
    if (n && n.__sep === 'cell') { cells.push([]); continue; }
    if (n && n.__sep === 'row') { rows.push(cells); cells = [[]]; continue; }
    if (n) cells[cells.length - 1].push(n);
  }
  rows.push(cells);

  const table = mm('mtable');
  for (const row of rows) {
    const tr = mm('mtr');
    for (const cell of row) tr.appendChild(mm.apply(null, ['mtd'].concat(texFlatten(cell))));
    table.appendChild(tr);
  }

  const delims = {
    pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'],
    vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''],
  };
  const d = delims[env];
  if (!d) return table;                     // matrix, array, aligned, gathered …
  const row = mm('mrow');
  if (d[0]) row.appendChild(mmTok('mo', d[0]));
  row.appendChild(table);
  if (d[1]) row.appendChild(mmTok('mo', d[1]));
  return row;
}

// ============================================================
// 7 · NODES → PLAIN WORDS
// ============================================================

function mdInlineText(src) {
  return nodeText(mdInline(src)).replace(/\s*\n\s*/g, ' ').trim();
}

// The words a node shows, with a line for each <br>. This is what makes the
// spoken text and the evaluated text the same text as the drawn text.
function nodeText(node) {
  let out = '';
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) { out += n.nodeValue; continue; }
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'BR') { out += '\n'; continue; }
    out += nodeText(n);
  }
  return out;
}
