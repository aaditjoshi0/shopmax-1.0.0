'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      await api('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push('/admin');
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="site-section"><div className="container" style={{ maxWidth: 480 }}>
      <h1>Admin Login</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-group"><label>Email</label><input required value={email} onChange={(e) => setEmail(e.target.value)} className="form-control" /></div>
        <div className="form-group"><label>Password</label><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="form-control" /></div>
        <button className="btn btn-black btn-block">Login</button>
      </form>
    </div></div>
  );
}
