'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '../../lib/api';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/orders').then((r) => setOrders(r.orders || r || [])).catch((e) => setError(e.message)); }, []);
  return (
    <div className="site-section"><div className="container">
      <h1>My Orders</h1>
      {error && <p>{error}</p>}
      {orders.length === 0 ? <p>No orders yet. <Link href="/shop">Shop now</Link></p> : orders.map((o) => (
        <div key={o.id} className="border p-3 mb-3">
          <p><strong>Order #{o.id}</strong> — {o.status} — {money(o.total)}</p>
          <Link href={`/order-details?id=${o.id}`}>View details</Link>
        </div>
      ))}
    </div></div>
  );
}
