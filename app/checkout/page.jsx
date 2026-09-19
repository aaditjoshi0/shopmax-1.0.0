'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, money } from '../../lib/api';

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState({ items: [], subtotal: 0 });
  const [form, setForm] = useState({ fname: '', address: '', phone: '', email_address: '', postal_zip: '', state_country: '' });
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);

  useEffect(() => { api('/api/cart').then(setCart).catch((e) => setError(e.message)); }, []);

  async function placeOrder(e) {
    e.preventDefault();
    setPlacing(true); setError('');
    try {
      const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({ shipping: form }) });
      router.push(`/thankyou?order=${order.id || ''}`);
    } catch (err) { setError(err.message); }
    finally { setPlacing(false); }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  return (
    <div className="site-section">
      <div className="container">
        <h1>Checkout</h1>
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="row">
          <div className="col-md-6">
            <form onSubmit={placeOrder}>
              {[['fname', 'Full name'], ['address', 'Address'], ['phone', 'Phone'], ['email_address', 'Email'], ['postal_zip', 'PIN code'], ['state_country', 'State / Country']].map(([k, label]) => (
                <div className="form-group" key={k}>
                  <label>{label}</label>
                  <input required value={form[k]} onChange={(e) => set(k, e.target.value)} className="form-control" />
                </div>
              ))}
              <button disabled={placing} className="btn btn-black">{placing ? 'Placing…' : `Place order · ${money(cart.subtotal)}`}</button>
            </form>
          </div>
          <div className="col-md-6">
            <h4>Order summary ({cart.items.length})</h4>
            {cart.items.map((it) => <p key={it.id}>{it.name} × {it.quantity} — {money(it.price * it.quantity)}</p>)}
            <h5>Total: {money(cart.subtotal)}</h5>
          </div>
        </div>
      </div>
    </div>
  );
}
