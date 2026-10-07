// Comment thread under a message: the latest few arrive with the message, older
// ones load a page at a time on request.
import { api, friendly } from './api.js';
import { ICON, el, iconButton, timeEl, showEdited, announce, showError } from './dom.js';
import { likeButton } from './likes.js';

const MAX_COMMENT = 500;
const CONFIRM_MS = 4000; // how long "Delete?" waits for a second tap

const countLabel = (n) => (n === 1 ? '1 comment' : n.toLocaleString() + ' comments');

export function commentsSection(m, me) {
  let total = m.comment_count;
  let shown = m.comments.length;
  let oldestId = m.comments[0]?.id;

  const wrap = el('div', 'comments');
  const heading = el('h2', '', countLabel(total));
  const list = el('div', 'comment-list');
  const older = el('button', 'link older', '');
  older.type = 'button';

  const updateOlder = () => {
    const hidden = total - shown;
    older.hidden = hidden <= 0;
    older.textContent = `View older comments (${hidden.toLocaleString()})`;
  };

  function commentItem(c) {
    const item = el('div', 'comment');
    const by = el('div', 'by', c.username);
    by.append(timeEl(c.created_at));
    if (c.edited_at) showEdited(by, c.edited_at);
    const text = el('p', '', c.body);

    const foot = el('div', 'comment-foot');
    foot.append(likeButton('comments', c, 'Like ' + c.username + '’s comment'));

    if (c.user_id === me.id) {
      const actions = el('div', 'actions');
      const edit = iconButton('Edit comment', ICON.edit, 'small');
      edit.onclick = async () => {
        const { openEditor } = await import('./editor.js');
        openEditor({
          item: c, bodyEl: text, actions,
          url: '/api/comments/' + c.id, label: 'Edit your comment', maxLength: MAX_COMMENT, rows: 2,
          onSaved: ({ edited_at }) => { if (edited_at) showEdited(by, edited_at); },
        });
      };

      // No dialog: the first tap arms the button ("Delete?"), a second tap within a few seconds deletes.
      const del = iconButton('Delete comment', ICON.trash, 'danger small');
      const idle = del.innerHTML;
      let armed = null;
      const disarm = () => {
        clearTimeout(armed);
        armed = null;
        del.innerHTML = idle;
        del.classList.remove('armed');
        del.setAttribute('aria-label', 'Delete comment');
      };
      del.onclick = async () => {
        if (!armed) {
          del.textContent = 'Delete?';
          del.classList.add('armed');
          del.setAttribute('aria-label', 'Confirm: delete comment');
          armed = setTimeout(disarm, CONFIRM_MS);
          return;
        }
        clearTimeout(armed);
        del.disabled = true;
        try {
          await api('DELETE', '/api/comments/' + c.id);
          item.remove();
          total = Math.max(0, total - 1);
          shown = Math.max(0, shown - 1);
          heading.textContent = countLabel(total);
          updateOlder();
          announce('Comment deleted.');
        } catch (err) {
          showError(friendly(err));
          del.disabled = false;
          disarm();
        }
      };
      actions.append(edit, del);
      foot.append(actions);
    }

    item.append(by, text, foot);
    return item;
  }

  list.append(...m.comments.map(commentItem));
  updateOlder();
  older.onclick = async () => {
    older.disabled = true;
    try {
      const { comments } = await api('GET', `/api/messages/${m.id}/comments?before=${oldestId}&limit=20`);
      if (comments.length) {
        list.prepend(...comments.reverse().map(commentItem));
        oldestId = comments[0].id;
        shown += comments.length;
      } else {
        shown = total; // the rest were deleted
      }
      updateOlder();
    } catch (err) {
      showError(friendly(err));
    } finally {
      older.disabled = false;
    }
  };

  const form = el('form', 'comment-form');
  const label = el('label', 'sr', 'Add a comment to ' + m.username + '’s message');
  label.htmlFor = 'comment-' + m.id;
  const input = el('input', 'field');
  input.id = 'comment-' + m.id;
  input.type = 'text';
  input.maxLength = MAX_COMMENT;
  input.placeholder = 'Write a comment…';
  input.autocomplete = 'off';
  input.required = true;
  const btn = el('button', 'primary', 'Comment');
  btn.type = 'submit';
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const created = await api('POST', `/api/messages/${m.id}/comments`, { body: text });
      list.append(commentItem(created));
      oldestId ??= created.id;
      total += 1;
      shown += 1;
      heading.textContent = countLabel(total);
      input.value = '';
      input.focus();
    } catch (err) {
      showError(friendly(err));
    } finally {
      btn.disabled = false;
    }
  };
  form.append(label, input, btn);

  wrap.append(heading, older, list, form);
  return wrap;
}
