// The signed-in screen. Loaded only after login.
//
// The feed is a sliding window over a list that may hold 100M messages: at most
// MAX_PAGES pages are in the DOM at once. Scrolling down loads older pages
// (?before=) and drops pages off the top; scrolling back up reloads newer pages
// (?after=) and drops pages off the bottom. All the browser keeps beyond the
// visible window is the id at each end of it, so memory stays flat however far
// you scroll.
import { api, friendly } from './api.js';
import { $, el, ICON, iconButton, whenEl, showEdited, colorOf, announce, showError } from './dom.js';
import { commentsSection } from './comments.js';
import { likeButton } from './likes.js';
import { route } from './main.js';

const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const UNDO_MS = 5000;
const MAX_MESSAGE = 2000;

let me = null;
let pages = [];        // [{ firstId, lastId, nodes }], newest first, in DOM order
let hasOlder = true;   // more messages below the window
let hasNewer = false;  // pages were dropped off the top
let busy = false;
let generation = 0;    // bumped by resetFeed(); responses from an older generation are thrown away
let pending = null;    // { id, card, timer }: delete waiting out its undo window
let wired = false;
let observer = null;

const feed = () => $('feed');

// ---------- Cards ----------

function messageCard(m, { fresh = false } = {}) {
  const own = m.user_id === me.id;
  const card = el('article', 'card msg c' + colorOf(m.username) + (fresh ? ' enter' : ''));
  card.dataset.id = m.id;
  card.setAttribute('aria-label', 'Message from ' + m.username);

  const head = el('div', 'msg-head');
  const meta = el('div', 'meta');
  const name = el('div', 'name', m.username);
  if (own) name.append(el('span', 'you', 'You'));
  const when = whenEl(m.created_at, m.edited_at);
  meta.append(name, when);
  head.append(el('div', 'avatar', m.username.charAt(0)), meta);

  const body = el('p', 'msg-body', m.body);

  if (own) {
    const actions = el('div', 'actions');
    const edit = iconButton('Edit message', ICON.edit, '');
    edit.onclick = async () => {
      const { openEditor } = await import('./editor.js');
      openEditor({
        item: m, bodyEl: body, actions,
        url: '/api/messages/' + m.id, label: 'Edit your message', maxLength: MAX_MESSAGE,
        onSaved: ({ edited_at }) => { if (edited_at) showEdited(when, edited_at); },
      });
    };
    const del = iconButton('Delete message', ICON.trash, 'danger');
    del.onclick = () => startDelete(m.id, card);
    actions.append(edit, del);
    head.append(actions);
  }

  const foot = el('div', 'msg-foot');
  foot.append(likeButton('messages', m, 'Like ' + m.username + '’s message'));

  card.append(head, body, foot, commentsSection(m, me));
  return card;
}

// ---------- Window ----------

// Keep `anchor` at the same spot on screen while content above it changes.
function keepPosition(anchor, change) {
  const before = anchor?.isConnected ? anchor.getBoundingClientRect().top : null;
  change();
  if (before !== null && anchor.isConnected) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
}

function makePage(messages) {
  return { firstId: messages[0].id, lastId: messages.at(-1).id, nodes: messages.map((m) => messageCard(m)) };
}

function dropPage(which) {
  const page = which === 'top' ? pages.shift() : pages.pop();
  const removeNodes = () => page.nodes.forEach((n) => n.remove());
  if (which === 'top') {
    keepPosition(pages[0]?.nodes.find((n) => n.isConnected), removeNodes);
    hasNewer = true;
  } else {
    removeNodes();
    hasOlder = true;
  }
}

function setStatus() {
  const visible = feed().querySelector('article:not([hidden])');
  $('empty').hidden = !!visible || hasOlder || hasNewer || busy;
  $('newer').hidden = !hasNewer;
  $('feed-status').textContent = busy ? 'Loading messages…' : (!hasOlder && visible ? 'You’ve reached the first message.' : '');
  $('feed-retry').hidden = true;
  feed().setAttribute('aria-busy', busy);
}

async function load(direction) {
  if (busy || !me) return;
  if (direction === 'older' ? !hasOlder : !hasNewer) return;
  busy = true;
  setStatus();
  const started = generation;
  try {
    const query = direction === 'older'
      ? (pages.length ? `?before=${pages.at(-1).lastId}` : '')
      : `?after=${pages[0].firstId}`;
    const { messages, hasMore } = await api('GET', `/api/messages${query}${query ? '&' : '?'}limit=${PAGE_SIZE}`);
    // The feed was reset while this request was in flight: its page belongs to the old feed.
    if (started !== generation) return;
    if (direction === 'older') {
      hasOlder = hasMore;
      if (messages.length) {
        const page = makePage(messages);
        pages.push(page);
        feed().append(...page.nodes);
        if (pages.length > MAX_PAGES) dropPage('top');
      }
    } else {
      hasNewer = hasMore;
      if (messages.length) {
        const page = makePage(messages);
        keepPosition(pages[0].nodes.find((n) => n.isConnected), () => feed().prepend(...page.nodes));
        pages.unshift(page);
        if (pages.length > MAX_PAGES) dropPage('bottom');
      }
    }
    busy = false;
    setStatus();
    fillViewport();
  } catch (err) {
    if (started !== generation) return;
    busy = false;
    setStatus();
    $('feed-status').textContent = 'Couldn’t load messages.';
    $('feed-retry').hidden = false;
    $('feed-retry').onclick = () => load(direction);
    showError(friendly(err));
  }
}

// The observer only fires when a sentinel crosses the margin, so after each
// load check again in case the sentinel is still in range (e.g. a tall screen).
const NEAR = 1000; // px beyond the viewport at which to start loading
function near(sentinel) {
  const r = sentinel.getBoundingClientRect();
  return r.top < window.innerHeight + NEAR && r.bottom > -NEAR;
}
function fillViewport() {
  if (hasOlder && near($('feed-bottom'))) load('older');
  else if (hasNewer && near($('feed-top'))) load('newer');
}

// Starts over from the newest messages. Any load still in flight is abandoned
// (via `generation`), so its stale page can't land in the fresh feed.
function resetFeed() {
  generation += 1;
  busy = false;
  pages = [];
  hasOlder = true;
  hasNewer = false;
  feed().replaceChildren();
  window.scrollTo(0, 0);
  return load('older');
}

// ---------- Delete with undo ----------

// The card is hidden at once; the delete is only sent after the undo window closes.
async function commitPending() {
  if (!pending) return;
  const { id, card, timer } = pending;
  clearTimeout(timer);
  pending = null;
  $('toast').hidden = true;
  try {
    await api('DELETE', '/api/messages/' + id);
    card.remove();
  } catch (err) {
    card.hidden = false;
    showError(friendly(err));
  }
  setStatus();
}

async function startDelete(id, card) {
  await commitPending();
  card.hidden = true;
  pending = { id, card, timer: setTimeout(commitPending, UNDO_MS) };
  $('toast').hidden = false;
  setStatus();
  announce('Message deleted. Undo available.');
  $('undo').focus();
}

function undo() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.card.hidden = false;
  pending = null;
  $('toast').hidden = true;
  setStatus();
  announce('Message restored.');
}

// ---------- Composer ----------

async function post(e) {
  e.preventDefault();
  const postBody = $('post-body');
  if (!postBody.value.trim()) return;
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const created = await api('POST', '/api/messages', { body: postBody.value });
    postBody.value = '';
    updateCount();
    if (hasNewer) {
      await resetFeed(); // we're deep in the past: jump back to the newest, which now includes this post
    } else {
      const card = messageCard(created, { fresh: true });
      feed().prepend(card);
      if (pages.length) { pages[0].nodes.unshift(card); pages[0].firstId = created.id; }
      else pages.push({ firstId: created.id, lastId: created.id, nodes: [card] });
      setStatus();
    }
    announce('Message posted.');
  } catch (err) {
    showError(friendly(err));
  } finally {
    button.disabled = false;
    postBody.focus();
  }
}

function updateCount() {
  $('post-count').textContent = $('post-body').value.length + ' / ' + MAX_MESSAGE;
}

// ---------- Lifecycle ----------

async function logout() {
  await commitPending();
  await api('POST', '/api/logout').catch(() => {});
  me = null;
  pages = [];
  feed().replaceChildren();
  route();
}

function wire() {
  $('post-form').onsubmit = post;
  $('post-body').oninput = updateCount;
  // Ctrl/Cmd + Enter posts from the textarea.
  $('post-body').onkeydown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('post-form').requestSubmit();
  };
  $('undo').onclick = undo;
  $('logout').onclick = logout;
  $('newer').querySelector('button').onclick = () => resetFeed().then(() => $('post-body').focus());

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      load(entry.target.id === 'feed-bottom' ? 'older' : 'newer');
    }
  }, { rootMargin: `${NEAR}px 0px` });
  observer.observe($('feed-top'));
  observer.observe($('feed-bottom'));
}

export function startFeed(user) {
  me = user;
  if (!wired) { wire(); wired = true; }
  $('me').textContent = me.username;
  resetFeed();
  $('post-body').focus();
}
