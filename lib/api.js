'use client';
// ShopMax CSR API client — replaces js/app.js `ShopMax.api` for Next.js.
// Same-origin by default; set NEXT_PUBLIC_API_URL when the Express API
// runs on a different origin (e.g. Vercel frontend + Railway backend).
const BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export async function api(path, opts = {}) {
  const init = { credentials: 'include', ...opts };
  if (!(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  }
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { body, status: res.status });
  }
  return body;
}

export function money(n) {
  return '₹' + Number(n || 0).toFixed(2);
}

export function esc(s) {
  return String(s ?? '');
}

export function priceOf(p) {
  return Number(p?.price || 0);
}
