// Reaction Learner — MV3 service worker.
//
// Page text reaches the app by two routes, and both end in the same extraction
// so the result is identical either way:
//
//   1 · toolbar click — grab the active tab's readable text (the activeTab
//       grant) and hand it to the app tab through chrome.storage.session;
//   2 · the Enter URL field in the source modal — the app asks us to load a
//       URL in a background tab, take its text, and close the tab again.
//
// Route 2 exists because the app page cannot do it itself. A plain fetch()
// would return the HTML before any script ran, which is an empty shell on
// every JavaScript-rendered site, and an extension ships no headless browser.
// A real tab that is never focused renders the page exactly as route 1 does —
// including signed-in and script-built content.
//
// Both routes hand back the same thing: a title and the page's text as Markdown,
// so a page's own headings arrive as headings in the reading pane.

const STORAGE_KEY = 'pendingGrab';
const TAB_KEY = 'appTabId';

const LOAD_TIMEOUT_MS = 20000;   // give up waiting for the page to finish loading
const RENDER_TIMEOUT_MS = 6000;  // single-page apps keep painting after 'complete'
const POLL_MS = 250;

// Injected into a page, so it may use the DOM freely.
//
// The result is Markdown, not flat text. innerText separated the blocks but threw
// away what they were, so an <h2> arrived as just another line and the reading pane
// had nothing left to draw as a heading. Walking the tree keeps that structure:
// a heading leaves here as "## Heading" and stays a heading all the way to the
// reader, which is the whole point of parsing in the page rather than after it.
//
// ONLY headings and paragraphs are emitted, deliberately. Anything else — bold,
// links, list bullets, code fences — would arrive at a renderer that does not
// draw it yet and would show up as its own punctuation in the middle of the text.
// Lists and blockquotes therefore survive as ordinary paragraphs, with their words
// intact and their markup dropped. Widen this and the renderer together.
//
// Everything here is defined inside the function: chrome.scripting serialises it
// and injects the source, so it cannot see anything outside its own body.
function extractReadable() {
  const SKIP = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1,
    FORM: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, NAV: 1,
  };
  const HEAD = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
  // Elements that hold one run of prose and nothing nested to walk into.
  const LEAF = {
    P: 1, FIGCAPTION: 1, DD: 1, DT: 1, TD: 1, TH: 1, CAPTION: 1, SUMMARY: 1,
    ADDRESS: 1, BLOCKQUOTE: 1, LI: 1,
  };

  // The words of an element with nothing added, so a <br> becomes the space it
  // looks like and a skipped element contributes nothing. textContent alone would
  // run "a<br>b" together into "ab".
  const words = (node) => {
    let s = '';
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { s += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (SKIP[tag] || n.hidden || n.getAttribute('aria-hidden') === 'true') continue;
      s += tag === 'BR' ? ' ' : words(n);
    }
    return s;
  };

  const lines = [];
  const push = (s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  };

  const walk = (node) => {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { push(n.nodeValue); continue; }  // text loose in a container
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (SKIP[tag] || n.hidden || n.getAttribute('aria-hidden') === 'true') continue;
      if (HEAD[tag]) { push('#'.repeat(HEAD[tag]) + ' ' + words(n)); continue; }
      if (LEAF[tag]) { push(words(n)); continue; }
      walk(n);   // containers: div, section, table, ul/ol, figure, header …
    }
  };

  const root = document.querySelector('article')
    || document.querySelector('main')
    || document.body;
  walk(root);

  return {
    title: document.title || '',
    url: location.href || '',
    text: lines.join('\n\n'),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- route 1 · toolbar click ----------
chrome.action.onClicked.addListener(async (tab) => {
  let grab = null;

  if (tab && /^https?:|^file:/.test(tab.url || '')) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractReadable,
      });
      const r = results && results[0] && results[0].result;
      if (r && r.text && r.text.trim()) {
        grab = r;
      }
    } catch {
      grab = null; // chrome:// pages, PDF viewer, no permission — fall through
    }
  }

  const token = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  if (grab) {
    await chrome.storage.session.set({
      [STORAGE_KEY]: { token, ...grab },
    });
  } else {
    await chrome.storage.session.set({
      [STORAGE_KEY]: { token, title: '', url: '', text: '' },
    });
  }

  const pageUrl = chrome.runtime.getURL('index.html') + '?grab=' + token;
  const stored = await chrome.storage.session.get(TAB_KEY);
  const existingId = stored[TAB_KEY];

  if (existingId != null) {
    try {
      const existing = await chrome.tabs.get(existingId);
      if (existing && existing.id != null && /index\.html/.test(existing.url || '')) {
        await chrome.tabs.update(existing.id, { url: pageUrl });
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
        return;
      }
    } catch { /* tab gone — fall through to create */ }
  }

  const created = await chrome.tabs.create({ url: pageUrl });
  if (created && created.id != null) {
    await chrome.storage.session.set({ [TAB_KEY]: created.id });
  }
});

// ---------- route 2 · the Enter URL field ----------
// The app page asks for the site before calling this: http://*/* and https://*/*
// are *optional* host permissions, so Chrome prompts for the single origin the
// user typed, and that grant is what lets the tab this opens be read. If
// executeScript is still refused — a PDF, a chrome:// page, an origin Chrome
// protects — we report "blocked" rather than guessing why.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fetch-url' || typeof msg.url !== 'string') return;
  handleFetchUrl(msg.url)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, reason: 'failed', detail: String((err && err.message) || err) }));
  return true; // the reply is asynchronous — keep the channel open
});

async function handleFetchUrl(url) {
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'scheme' };

  let result = null;
  try {
    result = await readUrlInHiddenTab(url);
  } catch (err) {
    // Refused on chrome:// pages and the PDF viewer, and on any origin without
    // host access — a PDF, a blocked origin and a missing permission all land
    // here, which is why the app's message stays general.
    return { ok: false, reason: 'blocked', detail: String((err && err.message) || err) };
  }

  if (!result || !result.text || !result.text.trim()) return { ok: false, reason: 'empty' };
  return { ok: true, title: result.title, url: result.url, text: result.text };
}

async function readUrlInHiddenTab(url) {
  // active:false so the user keeps their place. The tab still appears in the
  // strip for as long as the load takes, and is removed in the finally block.
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;

  try {
    await waitForLoad(tabId);

    // A 'complete' status means the first paint, not the final one: most
    // article sites fill the body in afterwards. Poll until there is text.
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    let last = null;
    for (;;) {
      last = await readTab(tabId);
      if (last && last.text && last.text.trim()) return last;
      if (Date.now() >= deadline) break;
      await sleep(POLL_MS);
    }
    return last;
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* user closed it already */ }
  }
}

async function waitForLoad(tabId) {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  for (;;) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return; // the tab is gone; the read that follows will report it
    }
    if (tab && tab.status === 'complete') return;
    if (Date.now() >= deadline) return;
    await sleep(POLL_MS);
  }
}

async function readTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractReadable,
  });
  return results && results[0] && results[0].result;
}
