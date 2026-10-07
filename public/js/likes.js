// The heart button under a message or a comment.
import { api, friendly } from './api.js';
import { ICON, el, svg, showError } from './dom.js';

// `kind` is 'messages' or 'comments'; `item` is the object the server sent
// (id, like_count, liked_by_me) and is kept up to date as the button is used.
export function likeButton(kind, item, label) {
  const button = el('button', 'like');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = svg(ICON.heart, 20);
  const count = el('span', 'like-count');
  button.append(count);

  const paint = () => {
    button.setAttribute('aria-pressed', item.liked_by_me);
    count.textContent = item.like_count > 0 ? item.like_count.toLocaleString() : '';
  };
  paint();

  let sending = false; // one request at a time, so quick double-taps can't race
  button.onclick = async () => {
    if (sending) return;
    sending = true;
    const was = { liked: item.liked_by_me, count: item.like_count };
    // Optimistic: show the result straight away, correct it from the server's reply.
    item.liked_by_me = !was.liked;
    item.like_count = Math.max(0, was.count + (was.liked ? -1 : 1));
    paint();
    try {
      const result = await api(was.liked ? 'DELETE' : 'PUT', `/api/${kind}/${item.id}/like`);
      item.liked_by_me = result.liked;
      item.like_count = result.like_count;
    } catch (err) {
      item.liked_by_me = was.liked;
      item.like_count = was.count;
      showError(friendly(err));
    } finally {
      sending = false;
      paint();
    }
  };
  return button;
}
