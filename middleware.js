// Next.js edge guard — replaces server.js login/admin guards.
// Keeps the same behavior: protected pages require a session cookie,
// /admin requires an admin session. API routes enforce real auth;
// this is only a page-level redirect (presence check — signed-cookie
// signature is verified by the API, not here).
import { NextResponse } from 'next/server';

const PUBLIC_PAGES = new Set([
  '/', '/login', '/register', '/admin-login',
  '/cart', '/checkout', '/orders', '/order-details',
  '/customize', '/saved', '/shop', '/men', '/women',
  '/marketplace', '/marketplace-item', '/product',
  '/about', '/contact', '/thankyou', '/shop-single',
  '/delivery-policy', '/return-policy', '/refund-policy',
]);

function hasSession(req, name) {
  const c = req.cookies.get(name);
  return !!(c && c.value);
}

export function middleware(req) {
  const { pathname } = req.nextUrl;

  // Skip API, Next internals, and static assets
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|webp|avif)$/i)
  ) {
    return NextResponse.next();
  }

  // Admin pages — require admin session (mirrors server.js admin guard)
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!hasSession(req, 'sm_admin_session')) {
      return NextResponse.redirect(new URL('/admin-login', req.url));
    }
    return NextResponse.next();
  }

  // Public routes (browsing) — always allowed
  if (
    PUBLIC_PAGES.has(pathname) ||
    pathname.startsWith('/product/') ||
    pathname === '/shop' ||
    pathname === '/men' ||
    pathname === '/women'
  ) {
    return NextResponse.next();
  }

  // Everything else (account, my-designs, etc.) requires a user session
  if (!hasSession(req, 'sm_session') && !hasSession(req, 'sm_admin_session')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
