'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Navbar() {
  const [user, setUser] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    api('/api/auth/me').then((r) => setUser(r.user || null)).catch(() => setUser(null));
    api('/api/cart').then((c) => setCartCount(c.count || 0)).catch(() => setCartCount(0));
  }, []);

  // The Navbar lives in the root layout and does NOT remount on client-side
  // navigation — re-sync auth + cart on every route change and whenever
  // login/register/logout fires 'sm-auth-changed'. Otherwise home keeps
  // showing the logged-out state right after signing in.
  useEffect(() => {
    refresh();
    window.addEventListener('sm-auth-changed', refresh);
    return () => window.removeEventListener('sm-auth-changed', refresh);
  }, [pathname, refresh]);

  async function logout(e) {
    e.preventDefault();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    try { window.dispatchEvent(new Event('sm-auth-changed')); } catch {}
    window.location.href = '/';
  }

  function submitSearch(e) {
    e.preventDefault();
    window.location.href = '/shop' + (q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '');
  }

  return (
    <div className="site-navbar bg-white">
      <div className="container">
        <div className="d-flex align-items-center justify-content-between">
          <div className="logo">
            <div className="site-logo">
              <Link href="/"><img src="/images/logo.png" alt="ShopMax" /></Link>
            </div>
          </div>
          <div className="main-nav d-none d-lg-block">
            <nav className="site-navigation text-right text-md-center" role="navigation">
              <ul className="site-menu d-none d-lg-block">
                <li><Link href="/men">Men</Link></li>
                <li><Link href="/women">Women</Link></li>
                <li><Link href="/shop">Home</Link></li>
                <li><Link href="/marketplace">Community Marketplace</Link></li>
                <li><Link href="/customize" className="sm-nav-cta">Customize</Link></li>
                <li><Link href="/shop">Accessories</Link></li>
              </ul>
            </nav>
          </div>
          <div className="icons">
            <a href="#" className="icons-btn d-inline-block" title="Search" onClick={(e) => { e.preventDefault(); setSearchOpen(!searchOpen); }}>
              <span className="icon-search" />
            </a>
            {user ? (
              <span className="icons-btn d-inline-block" title={user.name || user.email}>
                <span className="icon-user" />{' '}
                <small>
                  <Link href="/account">Account</Link> | <a href="#" onClick={logout}>Logout</a>
                  {user.role === 'admin' && <>{' '}| <Link href="/admin">Admin</Link></>}
                </small>
              </span>
            ) : (
              <Link href="/login" className="icons-btn d-inline-block" title="Login / Sign up"><span className="icon-user" /></Link>
            )}
            <Link href="/cart" className="icons-btn d-inline-block bag" title="Cart">
              <span className="icon-shopping-bag" />
              <span className="number js-cart-count">{cartCount}</span>
            </Link>
          </div>
        </div>
        {searchOpen && (
          <form onSubmit={submitSearch} className="py-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} className="form-control" placeholder="Search products…" autoFocus />
          </form>
        )}
      </div>
    </div>
  );
}
