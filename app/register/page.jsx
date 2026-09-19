'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, notifyAuthChanged } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify(form) });
      notifyAuthChanged();
      router.push('/');
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="site-section"><div className="container" style={{ maxWidth: 480 }}>
      <h1>Register</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-group"><label>Name</label><input required value={form.name} onChange={(e) => set('name', e.target.value)} className="form-control" /></div>
        <div className="form-group"><label>Email</label><input required value={form.email} onChange={(e) => set('email', e.target.value)} className="form-control" /></div>
        <div className="form-group"><label>Password</label><input required type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className="form-control" /></div>
        <button className="btn btn-black btn-block">Create account</button>
      </form>
      <p className="mt-3">Have an account? <Link href="/login">Login</Link></p>
    </div></div>
  );
}
