// Inline editor for your own message or comment. Downloaded the first time someone clicks Edit.
import { api, friendly } from './api.js';
import { el, announce, showError } from './dom.js';

// Swaps the text for a form; restores it on cancel or save.
//   item    the message/comment object (id, body); updated after a save
//   bodyEl  the element showing the text
//   actions the row of buttons to hide while editing
//   url     the PUT endpoint, e.g. /api/messages/5
//   onSaved called with the server's reply, so the caller can refresh its "(edited)" marker
export function openEditor({ item, bodyEl, actions, url, label, maxLength, rows = 3, onSaved }) {
  const form = el('form', 'edit-form');
  const labelEl = el('label', 'sr', label);
  labelEl.htmlFor = 'edit-' + url.replace(/\W+/g, '-');
  const area = el('textarea', 'field area');
  area.id = labelEl.htmlFor;
  area.rows = rows;
  area.maxLength = maxLength;
  area.required = true;
  area.value = item.body;

  const row = el('div', 'row');
  const cancel = el('button', 'outline', 'Cancel');
  cancel.type = 'button';
  const save = el('button', 'primary', 'Save');
  save.type = 'submit';
  row.append(cancel, save);
  form.append(labelEl, area, row);

  const close = () => {
    form.remove();
    bodyEl.hidden = false;
    actions.hidden = false;
    actions.querySelector('button').focus();
  };
  cancel.onclick = close;
  area.onkeydown = (e) => { if (e.key === 'Escape') close(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text) return;
    save.disabled = true;
    try {
      const saved = await api('PUT', url, { body: text });
      item.body = saved.body;
      item.edited_at = saved.edited_at;
      bodyEl.textContent = saved.body;
      onSaved?.(saved);
      close();
      announce('Saved.');
    } catch (err) {
      showError(friendly(err));
      save.disabled = false;
    }
  };

  bodyEl.hidden = true;
  actions.hidden = true;
  bodyEl.after(form);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}
