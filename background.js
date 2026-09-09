// Reaction Learner — MV3 service worker.
// Toolbar click → grab the active tab's readable text (activeTab grant) →
// stash it in chrome.storage.session (memory-only handoff buffer, cleared on
// read / browser restart) → open / focus the app tab with a one-time token.

const STORAGE_KEY = 'pendingGrab';
const TAB_KEY = 'appTabId';

chrome.action.onClicked.addListener(async (tab) => {
  let grab = null;

  if (tab && /^https?:|^file:/.test(tab.url || '')) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const pick = (el) => (el && el.innerText ? el.innerText : '');
          const root = document.querySelector('article')
            || document.querySelector('main')
            || document.body;
          return {
            title: document.title || '',
            url: location.href || '',
            text: pick(root),
          };
        },
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
