// ============================================================
// Reactions pane — markup only
// ============================================================
// Mounted into the [data-view="reactions"] placeholder inside .split by the
// mountView() call at the bottom of this file. Behaviour lives in js/reactions.js.

'use strict';

const REACTIONS_VIEW_HTML = `
    <!-- reactions: a full-screen sheet — identical on desktop & mobile. It covers
         the text so you recall from memory, and “React here” opens it. -->
    <section class="reactions-col" id="reactions-col">
      <div class="reactions-head">
        <span class="head-title">Reactions</span>
        <span class="recall-badge" title="The source text is covered while you write"><span class="ic ic-eye-off" aria-hidden="true"></span>Recall from memory</span>
        <div class="spacer"></div>
        <div class="head-actions">
          <div class="menu-wrap">
            <button id="btn-export" class="btn icon-btn" title="Export this session" aria-label="Export this session" aria-haspopup="true" aria-expanded="false" disabled><span class="ic ic-download" aria-hidden="true"></span></button>
            <div id="export-menu" class="menu hidden" role="menu">
              <button class="menu-item" data-format="json" role="menuitem">JSON</button>
              <button class="menu-item" data-format="markdown" role="menuitem">Markdown</button>
            </div>
          </div>
          <button id="btn-close-reactions" class="btn compact" title="Back to the text"><span class="ic ic-eye" aria-hidden="true"></span>Show text</button>
        </div>
      </div>
      <div id="reactions" class="reactions">
        <div class="empty-state">Click a paragraph to set your spot, press <b>React here</b>, and your reactions + AI evaluations will appear here.</div>
      </div>
      <div class="composer">
        <div id="react-hint" class="dim">Click a paragraph, then press <b>React here</b>.</div>
        <div class="composer-row">
          <textarea id="react-text" rows="1" placeholder="Type your reaction here or click the mic and just say it…" disabled></textarea>
          <button id="btn-mic" class="btn icon-btn" disabled title="Native speech-to-text" aria-label="Record your reaction"><span class="ic ic-mic" aria-hidden="true"></span><span class="rec-label">Recording</span></button>
          <button id="btn-send" class="btn primary icon-btn" title="Send" aria-label="Send reaction" disabled><span class="ic ic-send" aria-hidden="true"></span></button>
        </div>
      </div>
    </section>
`;

mountView('reactions', REACTIONS_VIEW_HTML);
