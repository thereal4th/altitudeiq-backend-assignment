// Every call goes to our own origin with a JSON body, which is what the server's
// CSRF check (sameOrigin middleware) expects.
export async function api(method, url, data) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong');
  return json;
}

export const friendly = (err) => (err.message === 'Failed to fetch' ? 'You appear to be offline. Try again.' : err.message);
