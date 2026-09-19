'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, notifyAuthChanged } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      notifyAuthChanged();
      let next = '/';
      try {
        const n = new URLSearchParams(window.location.search).get('next');
        if (n && n.startsWith('/') && !n.startsWith('//')) next = n;
      } catch {}
      router.push(next);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="site-section"><div className="container" style={{ maxWidth: 480 }}>
      <h1>Login</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-group"><label>Email</label><input required value={email} onChange={(e) => setEmail(e.target.value)} className="form-control" /></div>
        <div className="form-group"><label>Password</label><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="form-control" /></div>
        <button className="btn btn-black btn-block">Login</button>
      </form>
      <p className="mt-3">No account? <Link href="/register">Register</Link></p>
    </div></div>
  );
}
