'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '../../lib/api';

export default function CartPage() {
  const [cart, setCart] = useState({ items: [], subtotal: 0, count: 0 });
  const [error, setError] = useState('');

  async function load() {
    try { setCart(await api('/api/cart')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function updateQty(item, quantity) {
    await api(`/api/cart/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
    load();
  }
  async function removeItem(item) {
    await api(`/api/cart/items/${item.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="site-section">
      <div className="container">
        <h1>Cart</h1>
        {error && <p>{error}</p>}
        {cart.items.length === 0 ? <p>Your cart is empty. <Link href="/shop">Continue shopping</Link></p> : (
          <>
            {cart.items.map((it) => (
              <div key={it.id} className="row mb-3 border-bottom pb-3">
                <div className="col-md-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={it.image_url} alt={it.name} className="img-fluid" /></div>
                <div className="col-md-6"><h5>{it.name}</h5><p>{it.size} {it.color}</p><p>{money(it.price)}</p></div>
                <div className="col-md-2">
                  <input type="number" min="1" value={it.quantity} onChange={(e) => updateQty(it, Number(e.target.value))} className="form-control" />
                </div>
                <div className="col-md-2"><button className="btn btn-sm btn-danger" onClick={() => removeItem(it)}>Remove</button></div>
              </div>
            ))}
            <h4>Subtotal: {money(cart.subtotal)}</h4>
            <Link href="/checkout" className="btn btn-black">Checkout</Link>
          </>
        )}
      </div>
    </div>
  );
}
