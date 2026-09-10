// ============================================================
// REACTION FLOW — the sheet, the composer, sending for evaluation
// ============================================================
// One full-screen sheet, the same on desktop and mobile: it covers the reading
// pane so you write from memory. “React here” opens it armed for a new reaction;
// the corner pill reopens it read-only. The markup lives in js/reactions-view.js.

'use strict';

function setReactionsOpen(open) {
  state.reactionsOpen = open;
  document.body.classList.toggle('reactions-closed', !open);
  els.reactionsCol.classList.toggle('open', open);
  els.btnReactions.classList.toggle('hidden', open); // pill shows only while the sheet is hidden
  if (open) {
    scrollBottom(els.reactions);
  } else {
    stopListening();
  }
}

function openReactions() { setReactionsOpen(true); }
function closeReactions() { setReactionsOpen(false); }

// Focus the reaction input. A hidden/disabled field refuses focus silently, so
// this retries across the next few frames — and stops the moment the user has
// deliberately focused something else (or closed the sheet).
function focusComposer() {
  const put = () => {
    const ta = els.reactText;
    if (!state.reactionsOpen || ta.disabled) return false;
    const cur = document.activeElement;
    if (cur && cur !== ta && cur !== document.body && cur.tagName !== 'BUTTON') return false;
    ta.focus();
    if (typeof ta.setSelectionRange === 'function') {
      const end = ta.value.length;
      try { ta.setSelectionRange(end, end); } catch { /* not selectable */ }
    }
    return document.activeElement === ta;   // did it actually take?
  };
  put();                                     // works as soon as the sheet is shown
  requestAnimationFrame(put);
  setTimeout(put, 120);
  setTimeout(put, 320);                      // after the slide-in finishes
}

// ---------- rendering ----------
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

// ---------- wiring ----------
function wireReactions() {
  els.btnReactions.addEventListener('click', () => {
    // the pill is a read-only look at past reactions — it never arms a new one,
    // so a half-written reaction can’t linger behind the sheet
    if (state.reactionsOpen) { closeReactions(); return; }
    if (state.pending) {
      state.pending = null;
      setStatus('Press “React here” to write a reaction from memory');
    }
    openReactions();
    updateControls();
  });
  els.btnCloseReactions.addEventListener('click', closeReactions);

  els.btnReact.addEventListener('click', () => {
    if (state.paras.length === 0) { setStatus('Load a source text first', 'error'); return; }
    if (state.markerP < 0) { setStatus('Click a paragraph to set your spot first', 'error'); return; }
    if (state.busyEval) { setStatus('Wait for the current evaluation to finish', 'error'); return; }
    stopTTS();
    const rearming = !state.pending || state.pending.markerP !== state.markerP;
    state.pending = { markerP: state.markerP };
    if (rearming) {
      state.voiceTyped = false;
      els.reactText.value = '';
      autoGrowComposer();
    }
    openReactions();          // full screen: the text is now out of sight — recall from memory
    updateControls();
    focusComposer();          // caret is ready the moment the sheet is up
    setStatus(`Reacting at ¶ ${state.markerP + 1} — the text is hidden, write from memory`, 'success');
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
    stopListening();

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
    autoGrowComposer();
    state.reactions.push(reaction);
    renderReaction(reaction);
    updateControls();
    await runEvaluation(reaction, prov);
  });
}
