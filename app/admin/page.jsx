'use client';
import { useEffect, useState } from 'react';
import { api, money } from '../../lib/api';

// Admin CSR console — replaces admin.html (2216 lines) incrementally.
// Core product/order tables are live via /api; full product editor,
// coupons, variants and image-upload UI follow the same CSR pattern.
export default function AdminPage() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('products');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/products?admin=true').then((r) => setProducts(Array.isArray(r) ? r : [])).catch((e) => setError(e.message));
    api('/api/admin/orders').then((r) => setOrders(r.orders || r || [])).catch(() => {});
  }, []);

  return (
    <div className="site-section"><div className="container">
      <h1>Admin</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="mb-3">
        <button onClick={() => setTab('products')} className="btn btn-sm btn-black mr-2">Products ({products.length})</button>
        <button onClick={() => setTab('orders')} className="btn btn-sm btn-outline-dark">Orders ({orders.length})</button>
      </div>
      {tab === 'products' ? (
        <table className="table table-sm">
          <thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
          <tbody>{products.map((p) => <tr key={p.id}><td>{p.id}</td><td>{p.name}</td><td>{money(p.price)}</td><td>{p.stock}</td><td>{p.status}</td></tr>)}</tbody>
        </table>
      ) : (
        <table className="table table-sm">
          <thead><tr><th>ID</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{orders.map((o) => <tr key={o.id}><td>{o.id}</td><td>{money(o.total)}</td><td>{o.status}</td></tr>)}</tbody>
        </table>
      )}
    </div></div>
  );
}
