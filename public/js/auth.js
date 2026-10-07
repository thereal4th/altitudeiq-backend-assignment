// Login / register screen. Loaded only when nobody is signed in.
import { api } from './api.js';
import { $ } from './dom.js';
import { route } from './main.js';

let mode = 'login';
let wired = false;

function showAuthError(message) {
  $('auth-error').hidden = !message;
  $('auth-error-text').textContent = message || '';
}

function showConfirmError(show) {
  $('confirm-error').hidden = !show;
  $('confirm').setAttribute('aria-invalid', show);
}

function setMode(next) {
  mode = next;
  const login = mode === 'login';
  $('tab-login').setAttribute('aria-pressed', login);
  $('tab-register').setAttribute('aria-pressed', !login);
  $('auth-heading').textContent = login ? 'Welcome back' : 'Create your account';
  $('auth-sub').textContent = login ? 'Log in to join the conversation.' : 'Pick a username and a password of at least 8 characters.';
  $('auth-submit').textContent = login ? 'Log in' : 'Create account';
  $('switch-prompt').textContent = login ? 'New here?' : 'Already have an account?';
  $('switch-mode').textContent = login ? 'Create an account' : 'Log in';
  $('password').autocomplete = login ? 'current-password' : 'new-password';
  $('password').minLength = login ? 0 : 8;
  $('confirm-group').hidden = login;
  $('confirm').required = !login;
  $('confirm').value = '';
  showConfirmError(false);
  showAuthError('');
}

function wire() {
  $('tab-login').onclick = () => setMode('login');
  $('tab-register').onclick = () => setMode('register');
  $('switch-mode').onclick = () => setMode(mode === 'login' ? 'register' : 'login');

  // Each password field has its own Show/Hide button.
  for (const button of document.querySelectorAll('.toggle-pw')) {
    button.onclick = () => {
      const field = $(button.dataset.field);
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + button.dataset.label);
      button.setAttribute('aria-pressed', show);
    };
  }

  $('confirm').oninput = () => showConfirmError(false);
  $('password').oninput = () => showConfirmError(false);

  $('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    if (mode === 'register' && $('password').value !== $('confirm').value) {
      showConfirmError(true);
      $('confirm').focus();
      return;
    }
    const submit = $('auth-submit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = mode === 'login' ? 'Logging in…' : 'Creating account…';
    showAuthError('');
    try {
      await api('POST', mode === 'login' ? '/api/login' : '/api/register', {
        username: $('username').value,
        password: $('password').value,
      });
      e.target.reset();
      await route();
    } catch (err) {
      showAuthError(err.message === 'Failed to fetch' ? 'Can’t reach the server. Check your connection and try again.' : err.message);
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  };
}

export function startAuth() {
  if (!wired) { wire(); wired = true; }
  setMode('login');
  $('username').focus();
}
