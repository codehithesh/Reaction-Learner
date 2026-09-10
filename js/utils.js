// ============================================================
// Small pure helpers — no DOM, no state
// ============================================================

'use strict';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

function fmtPct(f) { return Math.round(f * 100) + '%'; }

function slug(s) {
  return (s || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';
}
