// Entry point: the only <script> in index.html. It works out who's here, then
// downloads just the code for that screen. import() fetches a module the first
// time it runs; after that the browser reuses the loaded copy.
import { api } from './api.js';
import { $ } from './dom.js';

export async function route() {
  let me = null;
  try {
    me = await api('GET', '/api/me');
  } catch {
    // Offline or server down: fall through to the login screen.
  }
  $('auth').hidden = !!me;
  $('app').hidden = !me;
  if (me) {
    const { startFeed } = await import('./feed.js');
    startFeed(me);
  } else {
    const { startAuth } = await import('./auth.js');
    startAuth();
  }
}

route();
