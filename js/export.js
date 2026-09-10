// ============================================================
// EXPORT — generated & downloaded in-browser
// ============================================================
// The session is serialised from the in-memory state only; nothing is uploaded
// and nothing is stored. The dropdown lives in the reactions sheet header.

'use strict';

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

function exportSession(fmt) {
  if (!fmt || !state.reactions.length) return;
  const base = `reaction-learner-${slug(state.sourceTitle)}-${Date.now()}`;
  if (fmt === 'json') {
    downloadBlob(
      new Blob([JSON.stringify(buildJson(), null, 2)], { type: 'application/json' }),
      base + '.json'
    );
  } else if (fmt === 'markdown') {
    downloadBlob(new Blob([buildMarkdown()], { type: 'text/markdown' }), base + '.md');
  }
}

function openExportMenu() {
  if (els.btnExport.disabled) return;
  els.exportMenu.classList.remove('hidden');
  els.btnExport.setAttribute('aria-expanded', 'true');
}

function closeExportMenu() {
  els.exportMenu.classList.add('hidden');
  els.btnExport.setAttribute('aria-expanded', 'false');
}

// ---------- wiring ----------
function wireExport() {
  els.btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    if (els.exportMenu.classList.contains('hidden')) openExportMenu(); else closeExportMenu();
  });
  els.exportMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    closeExportMenu();
    exportSession(item.dataset.format);
  });
  document.addEventListener('click', (e) => {
    if (!els.exportMenu.classList.contains('hidden') && !e.target.closest('.menu-wrap')) closeExportMenu();
  });
}
