/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // CSR-first: no static export, default Node runtime on Vercel.
  // Legacy .html URLs rewrite to Next routes so old links keep working
  // without serving static HTML files.
  // /api/* is served in-process by app/api/[...path]/route.js (Express bridge),
  // same-origin everywhere: local dev, `next start`, and Vercel. No rewrite needed.
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
