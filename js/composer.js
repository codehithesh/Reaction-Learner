// ============================================================
// COMPOSER + CONTROL STATE
// ============================================================
// Two halves of the same thing: the auto-growing reaction input, and the single
// place that decides which controls are enabled and what the hint under the
// composer says. Every module that changes what the user can do calls
// updateControls() rather than poking .disabled itself.

'use strict';

// Starts as a single-line field, grows as the text wraps, and scrolls
// once it hits the CSS max-height.
function autoGrowComposer() {
  const ta = els.reactText;
  const max = parseFloat(getComputedStyle(ta).maxHeight) || 140;
  ta.style.height = 'auto';               // measure the natural content height
  const h = ta.scrollHeight;
  ta.style.height = h + 'px';             // CSS max-height clamps the grown box
  ta.classList.toggle('grown', h > max + 1);
}

function updateControls() {
  const hasSource = state.paras.length > 0;
  const canReact = hasSource && state.markerP >= 0 && !state.busyEval;
  els.btnReact.disabled = !canReact;

  const canCompose = !!state.pending && !state.busyEval && hasSource;
  els.reactText.disabled = !canCompose;
  els.btnMic.disabled = !canCompose || !state.sttSupported;
  els.btnSend.disabled = !canCompose || !els.reactText.value.trim();

  els.btnExport.disabled = state.reactions.length === 0;
  if (els.btnExport.disabled) closeExportMenu();
  if (state.pending) {
    els.reactHint.textContent = `Reacting at ¶ ${state.pending.markerP + 1} — the text is covered, so recall it from memory. “Show text” brings it back.`;
  } else if (state.busyEval) {
    els.reactHint.textContent = 'Evaluating your reaction…';
  } else {
    els.reactHint.textContent = 'Click a paragraph to set your spot, then press "React here" to write from memory.';
  }
}

function wireComposer() {
  els.reactText.addEventListener('input', autoGrowComposer);
  els.reactText.addEventListener('input', updateControls);
  els.reactText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.btnSend.click(); }
  });
}
