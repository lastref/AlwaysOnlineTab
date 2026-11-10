// Minimal test app with two kinds of idle logout:
//  - server side: session expires after SERVER_TTL_MS without a request
//  - client side: page logs itself out after CLIENT_IDLE_MS without
//    mouse/keyboard activity or while hidden
import { randomBytes } from 'node:crypto';
import http from 'node:http';

export function startServer({ serverTtlMs, clientIdleMs }) {
  const sessions = new Map(); // sid -> { lastSeen, clientLogout, label }

  const page = (label) => `<!doctype html><meta charset="utf-8"><title>${label}</title>
<h1 id="state">logged in</h1>
<script>
  let last = Date.now();
  let hiddenSince = document.hidden ? Date.now() : 0;
  for (const t of ['mousemove', 'keydown', 'pointermove', 'scroll']) {
    addEventListener(t, () => { last = Date.now(); }, true);
  }
  document.addEventListener('visibilitychange', () => {
    hiddenSince = document.hidden ? Date.now() : 0;
  });
  setInterval(() => {
    const idle = Date.now() - last;
    const hidden = hiddenSince ? Date.now() - hiddenSince : 0;
    if (idle > ${clientIdleMs} || hidden > ${clientIdleMs}) {
      fetch('/client-logout', { method: 'POST' }).finally(() => location.replace('/logged-out'));
    }
  }, 1000);
</script>`;

  const sidOf = (req) => /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  const alive = (s) => s && !s.clientLogout && Date.now() - s.lastSeen <= serverTtlMs;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const sid = sidOf(req);
    const session = sid && sessions.get(sid);

    if (url.pathname === '/debug') {
      res.setHeader('content-type', 'application/json');
      const out = {};
      for (const [, s] of sessions) out[s.label] = { alive: Boolean(alive(s)), clientLogout: s.clientLogout, requests: s.requests };
      return res.end(JSON.stringify(out));
    }
    if (url.pathname === '/login') {
      const id = randomBytes(16).toString('hex');
      sessions.set(id, { lastSeen: Date.now(), clientLogout: false, label: url.searchParams.get('label') || id, requests: 0 });
      res.writeHead(302, { 'set-cookie': `sid=${id}; Path=/; HttpOnly; SameSite=Lax`, location: '/app' });
      return res.end();
    }
    if (url.pathname === '/client-logout' && req.method === 'POST') {
      if (session) session.clientLogout = true;
      return res.end('ok');
    }
    if (url.pathname === '/app') {
      if (!alive(session)) {
        res.writeHead(401, { 'content-type': 'text/plain' });
        return res.end('session expired');
      }
      session.lastSeen = Date.now();
      session.requests += 1;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(page(session.label));
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('logged out');
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
