'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function MarketplacePage() {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/api/marketplace').then((r) => setItems(r.items || r || [])).catch(() => {}); }, []);
  return (
    <div className="site-section"><div className="container">
      <h1>Community Marketplace</h1>
      <div className="row">
        {items.map((m) => (
          <div key={m.id} className="col-md-4 mb-4">
            <Link href={`/marketplace-item?id=${m.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.image_url && <img src={m.image_url} alt={m.title} className="img-fluid" />}
              <h5>{m.title}</h5>
            </Link>
          </div>
        ))}
      </div>
      {items.length === 0 && <p>No community designs yet.</p>}
    </div></div>
  );
}
