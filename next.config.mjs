/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // CSR-first: no static export, default Node runtime on Vercel.
  // Legacy .html URLs rewrite to Next routes so old links keep working
  // without serving static HTML files.
  // Same-origin /api in the browser. In local dev the Express API runs on
  // :3001 (PORT=3001 npm run dev:express) and Next rewrites /api -> :3001,
  // so cookies stay same-origin (no CORS). On Vercel no rewrite is applied —
  // /api is served by Route Handlers (migrated next) or NEXT_PUBLIC_API_URL.
  async rewrites() {
    if (process.env.VERCEL) return [];
    const apiOrigin = process.env.API_ORIGIN || 'http://127.0.0.1:3001';
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async redirects() {
    const legacy = [
      'index', 'shop', 'men', 'women', 'product', 'shop-single',
      'cart', 'checkout', 'login', 'register', 'orders', 'order-details',
      'account', 'admin', 'admin-login', 'marketplace', 'marketplace-item',
      'customize', 'my-designs', 'saved', 'about', 'contact', 'thankyou',
      'delivery-policy', 'return-policy', 'refund-policy',
    ];
    return legacy.map((p) => ({
      source: `/${p}.html`,
      destination: p === 'index' ? '/' : `/${p}`,
      permanent: true,
    }));
  },
};

export default nextConfig;
