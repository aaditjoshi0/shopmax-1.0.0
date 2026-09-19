// Single-project API: reuses the existing Express app (server.js + src/api/*)
// inside a Next.js Route Handler, so Vercel serves /api/* with no separate
// Express deployment. Auth (signed cookies), routers and Supabase/local modes
// are unchanged — requests are forwarded over loopback with cookies intact.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function getExpressPort() {
  if (!globalThis.__shopmaxExpressPort) {
    globalThis.__shopmaxExpressPort = new Promise((resolve, reject) => {
      try {
        const app = require('../../../server.js');
        const server = app.listen(0, '127.0.0.1', () => {
          resolve(server.address().port);
        });
        server.on('error', reject);
      } catch (e) {
        reject(e);
      }
    });
  }
  return globalThis.__shopmaxExpressPort;
}

async function forward(req, context) {
  const params = await context.params;
  let port;
  try {
    port = await getExpressPort();
  } catch (e) {
    return Response.json({ error: 'API backend failed to start' }, { status: 502 });
  }
  const url = new URL(req.url);
  const rest = (params?.path || []).join('/');
  const target = `http://127.0.0.1:${port}/api/${rest}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('host', `127.0.0.1:${port}`);
  headers.set('x-forwarded-proto', url.protocol.replace(':', '') || 'https');
  headers.delete('content-length');

  const init = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Buffer.from(await req.arrayBuffer());
    init.duplex = 'half';
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    // Cold-boot race: Express listener may not accept yet — retry once.
    await new Promise((r) => setTimeout(r, 500));
    try {
      upstream = await fetch(target, init);
    } catch (e2) {
      return Response.json({ error: 'API backend unreachable' }, { status: 502 });
    }
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key === 'set-cookie') return; // re-appended individually below
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) return;
    out.append(key, value);
  });
  for (const c of upstream.headers.getSetCookie?.() ?? []) {
    out.append('set-cookie', c);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
