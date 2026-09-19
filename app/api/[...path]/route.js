// Single-project API: runs the existing Express app (server.js + src/api/*)
// in-process via serverless-http — no TCP listen, so it works in serverless
// (Vercel) as well as local dev. Auth (signed cookies), routers and
// Supabase/local modes are unchanged.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverlessHttp = require('serverless-http');

let handlerPromise = null;
function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      try {
        const app = require('../../../server.js');
        return serverlessHttp(app, {
          binary: ['image/*', 'application/pdf', 'application/octet-stream'],
        });
      } catch (e) {
        console.error('[api bridge] backend failed to boot:', e?.stack || e?.message || e);
        throw e;
      }
    })();
  }
  return handlerPromise;
}

async function forward(req, context) {
  let handler;
  try {
    handler = await getHandler();
  } catch (e) {
    return Response.json({ error: 'API backend failed to start' }, { status: 502 });
  }

  const params = await context.params;
  const url = new URL(req.url);
  const headers = {};
  req.headers.forEach((value, key) => {
    if (key === 'content-length') return; // body is re-encoded below
    headers[key] = value;
  });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const raw = hasBody ? Buffer.from(await req.arrayBuffer()) : null;

  const event = {
    httpMethod: req.method,
    path: '/api/' + ((params && params.path) || []).join('/'),
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    multiValueQueryStringParameters: null,
    body: raw ? raw.toString('base64') : null,
    isBase64Encoded: !!raw,
    requestContext: { identity: { sourceIp: '127.0.0.1' } },
  };

  let out;
  try {
    out = await handler(event, {});
  } catch (e) {
    console.error('[api bridge] request failed:', e?.stack || e?.message || e);
    return Response.json({ error: 'API backend error' }, { status: 502 });
  }

  const resHeaders = new Headers();
  for (const [key, value] of Object.entries(out.headers || {})) {
    if (key.toLowerCase() === 'set-cookie') continue; // appended individually below
    if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
    resHeaders.set(key, value);
  }
  const multi = out.multiValueHeaders || {};
  for (const [key, values] of Object.entries(multi)) {
    for (const value of [].concat(values)) resHeaders.append(key, value);
  }
  if (out.headers && out.headers['set-cookie'] && !multi['set-cookie']) {
    resHeaders.set('set-cookie', out.headers['set-cookie']);
  }

  const body = out.isBase64Encoded
    ? Buffer.from(out.body || '', 'base64')
    : (out.body ?? '');
  return new Response(body, { status: out.statusCode || 200, headers: resHeaders });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
