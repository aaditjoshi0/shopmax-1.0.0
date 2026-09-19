'use client';
import { use, useEffect, useState } from 'react';
import { api, money } from '../../../lib/api';

export default function ProductPage({ params }) {
  const { id } = use(params);
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api(`/api/products/${id}`).then(setP).catch((e) => setError(e.message));
  }, [id]);

  async function addToCart() {
    setMsg('');
    try {
      await api('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ product_id: Number(id), quantity: qty, size: size || undefined }),
      });
      setMsg('Added to cart.');
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <div className="container site-section"><h3>Could not load product</h3><p>{error}</p></div>;
  if (!p) return <div className="container site-section sm-loading">Loading product…</div>;

  return (
    <div className="site-section">
      <div className="container">
        <div className="row">
          <div className="col-md-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.image_url} alt={p.name} className="img-fluid" />
          </div>
          <div className="col-md-6">
            <h1>{p.name}</h1>
            <p><strong>{money(p.price)}</strong>{p.compare_at_price > p.price && <del> {money(p.compare_at_price)}</del>}</p>
            <p>{p.description}</p>
            <div className="form-group">
              <label>Size</label>
              <select value={size} onChange={(e) => setSize(e.target.value)} className="form-control">
                <option value="">Select size</option>
                {['S', 'M', 'L', 'XL', 'XXL'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Qty</label>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} className="form-control" />
            </div>
            <button onClick={addToCart} className="btn btn-black">Add to Cart</button>
            {msg && <p className="mt-2">{msg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
