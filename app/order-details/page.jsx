'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, money } from '../../lib/api';

function OrderDetailsInner() {
  const sp = useSearchParams();
  const id = sp.get('id');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    api(`/api/orders/${id}`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);
  if (!id) return <div className="container site-section"><p>Missing order id.</p></div>;
  if (error) return <div className="container site-section"><p>{error}</p></div>;
  if (!order) return <div className="container site-section">Loading…</div>;
  return (
    <div className="site-section"><div className="container">
      <h1>Order #{order.id}</h1>
      <p>Status: {order.status} · Total: {money(order.total)}</p>
      {(order.items || []).map((it, i) => <p key={i}>{it.name} × {it.quantity} — {money(it.price * it.quantity)}</p>)}
    </div></div>
  );
}

export default function OrderDetailsPage() {
  return <Suspense fallback={<div className="container site-section">Loading…</div>}><OrderDetailsInner /></Suspense>;
}
