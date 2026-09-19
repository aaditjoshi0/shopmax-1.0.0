'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function AccountPage() {
  const [user, setUser] = useState(null);
  useEffect(() => { api('/api/auth/me').then((r) => setUser(r.user)).catch(() => {}); }, []);
  if (!user) return <div className="container site-section">Loading account…</div>;
  return (
    <div className="site-section"><div className="container">
      <h1>My Account</h1>
      <p><strong>{user.name}</strong><br />{user.email}<br />{user.mobile || ''}</p>
    </div></div>
  );
}
