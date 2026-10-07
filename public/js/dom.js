export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Icon markup is constant; user text only ever goes through textContent.
export const ICON = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
};
export const svg = (icon, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
export function iconButton(label, icon, className) {
  const b = el('button', 'quiet ' + className);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(icon);
  return b;
}

// "(edited)" next to a timestamp. Safe to call again after another edit: it updates in place.
export function showEdited(parent, iso) {
  let node = parent.querySelector('.edited');
  if (!node) {
    node = el('span', 'edited', '(edited)');
    parent.append(node);
  }
  node.title = 'Edited ' + new Date(iso).toLocaleString();
}

// The timestamp line of a message or comment: "3 hours ago (edited)".
export function whenEl(createdAt, editedAt, tag = 'div') {
  const node = el(tag, 'when');
  node.append(timeEl(createdAt));
  if (editedAt) showEdited(node, editedAt);
  return node;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(iso) {
  const seconds = Math.round((new Date(iso) - Date.now()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function timeEl(iso) {
  const t = document.createElement('time');
  t.dateTime = new Date(iso).toISOString();
  t.title = new Date(iso).toLocaleString();
  t.textContent = ago(iso);
  return t;
}

// Each author gets a stable colour (avatar + card accent), derived from their name.
export function colorOf(username) {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

// Screen-reader announcement.
export function announce(text) {
  $('live').textContent = text;
}

let errorTimer;
export function showError(message) {
  clearTimeout(errorTimer);
  $('app-error-text').textContent = message;
  $('app-error').hidden = false;
  errorTimer = setTimeout(() => { $('app-error').hidden = true; }, 6000);
}
