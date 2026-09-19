'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function CustomizePage() {
  const [products, setProducts] = useState([]);
  useEffect(() => { api('/api/products?limit=50').then((r) => setProducts(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  return (
    <div className="site-section"><div className="container">
      <h1>Customize</h1>
      <p>Pick a base product to customize. Full canvas editor from customize.html is ported incrementally — products below come live from /api.</p>
      <div className="row">{products.slice(0, 12).map((p) => <div key={p.id} className="col-md-3 mb-3"><p>{p.name}</p></div>)}</div>
    </div></div>
  );
}
