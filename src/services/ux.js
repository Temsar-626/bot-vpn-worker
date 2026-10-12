// UX foundation for in-bot UI (no Mini App).
// Central design tokens + helpers so every screen shares the same
// hero structure, breadcrumbs, pagination, toggles and confirm pattern.
import { text as tr, label, cutBytes } from '../config.js';

export const UX = {
  // Semantic button colors (Bot API 9.4+). Old clients ignore `style`,
  // so every colored button also keeps its ✅/❌/🔑 emoji as fallback.
  STYLE: { PRIMARY: 'primary', SUCCESS: 'success', DANGER: 'danger', NONE: '' },
  // Max label length for thumb-friendly mobile buttons.
  LABEL_MAX: 20,
};

const FA_EMOJI = {
  buy: '🛍', services: '📡', wallet: '💳', trial: '🧪', gift: '🎁',
  agent: '🤝', wheel: '🎡', dice: '🎲', back: '◀', home: '🏠',
  cancel: '❌', confirm: '✅', copy: '📋', share: '📤', refresh: '🔄',
  support: '🛡', retry: '🔄',
};

// Shorten a button label for mobile (≤20 chars) without breaking words harshly.
export function shortLabel(value, max = UX.LABEL_MAX) {
  const s = label(value, 64).replace(/[\x00-\x20\x7F]+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

// Hero: 1-line bold title + 2-3 line pitch + optional meta line.
// We keep plain text (no parse_mode) so old clients render identically;
// formatting hierarchy comes from line breaks + emoji, not tags.
export function hero(title, pitch, meta = '') {
  const t = String(title || '').trim();
  const p = String(pitch || '').trim();
  const m = String(meta || '').trim();
  return [t, p ? `\n${p}` : '', m ? `\n${m}` : ''].join('').trim();
}

export function crumb(lang, parts = []) {
  const seq = (Array.isArray(parts) ? parts : []).filter(Boolean).join(' › ');
  return seq ? (lang === 'en' ? `· ${seq}` : `· ${seq}`) : '';
}

// "‹ ۱/۳ ›" style page indicator (fa digits when lang=fa).
export function pageIndicator(page, total, lang = 'fa') {
  const fmt = (n) => lang === 'en' ? String(n) : Number(n).toLocaleString('fa-IR');
  return `${fmt(page + 1)}/${fmt(Math.max(total, 1))}`;
}

export function progressBar(pct, width = 10) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const fill = Math.round((p / 100) * width);
  return `${'█'.repeat(fill)}${'░'.repeat(width - fill)} ${p}%`;
}

export function toggleLabel(on, text) {
  return `${on ? '✅' : '⬜'} ${text}`;
}

export function confirmStateLabel(on, text) {
  return `${on ? '🟢' : '🔴'} ${text}`;
}

// Standard back/home rows. Targets are explicit so callers never mix
// vpn:home (services home) with sub:root (generic menu home).
export function backButton(lang, target = 'vpn:home') {
  return { text: tr('◀ بازگشت', '◀ Back', lang), type: 'callback', value: target };
}
export function homeButton(lang, target = 'vpn:home') {
  return { text: tr('🏠 خدمات', '🏠 Services', lang), type: 'callback', value: target };
}
export function cancelButton(lang) {
  return { text: tr('❌ انصراف', '❌ Cancel', lang), type: 'callback', value: 'vpn:home' };
}

// Confirm screen rows: safe action first (left), destructive second with danger style.
export function confirmRows(lang, { confirmText, confirmValue, backTarget }) {
  return [
    [{ text: tr('❌ انصراف', '❌ Cancel', lang), type: 'callback', value: backTarget }],
    [{ text: confirmText, type: 'callback', value: confirmValue, style: UX.STYLE.DANGER }],
  ];
}

// Copy button (Bot API 7.11+). Falls back to plain callback on old clients
// because telegramButton() keeps callback_data alongside? No — copy_text is
// exclusive, so callers should ALSO keep the raw text in the message body.
export function copyButton(lang, copyText, labelText = null) {
  const text = labelText || tr('📋 کپی', '📋 Copy', lang);
  return { text, type: 'copy', value: String(copyText || '').slice(0, 256) };
}

// Referral/share button via switch_inline_query.
export function shareButton(lang, query, labelText = null) {
  const text = labelText || tr('📤 اشتراک با دوست', '📤 Share', lang);
  return { text, type: 'switch_inline', value: String(query || '') };
}

export function emptyState(lang, { title, hint, ctaText, ctaValue }) {
  return {
    text: `${title}\n${hint}`,
    rows: [
      [{ text: ctaText, type: 'callback', value: ctaValue, style: UX.STYLE.SUCCESS }],
      [backButton(lang)],
    ],
  };
}

export { FA_EMOJI };
