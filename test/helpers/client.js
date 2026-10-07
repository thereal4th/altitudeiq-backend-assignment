// A tiny HTTP client with its own cookie jar, so each test can act as a different user.
function client(ctx) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(ctx.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...headers },
      body: body === undefined || body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  }
  call.cookie = () => cookie;
  call.setCookie = (value) => { cookie = value; };
  return call;
}

// The session id inside a signed "wall.sid=s%3A<id>.<signature>" cookie.
const sessionId = (cookie) => decodeURIComponent(cookie.split('=')[1] || '').replace(/^s:/, '').split('.')[0];

module.exports = { client, sessionId };
