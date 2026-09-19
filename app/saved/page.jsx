'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function SavedPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/api/wishlist').then((r) => setItems(r.items || r || [])).catch(() => {}); }, []);
  return (
    <div className="site-section"><div className="container">
      <h1>Wishlist &amp; Saved</h1>
      {items.length === 0 ? <p>Nothing saved yet.</p> : items.map((w) => <p key={w.id}>{w.product_name || w.product_id}</p>)}
    </div></div>
  );
}
