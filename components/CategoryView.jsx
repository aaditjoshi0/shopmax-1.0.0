'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../lib/api';
import ProductCard from './ProductCard';

export default function CategoryView({ category, title, blurb }) {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || '';
  const [items, setItems] = useState([]);
  const [sort, setSort] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    if (sort) params.set('sort', sort);
    api('/api/products' + (params.toString() ? `?${params}` : ''))
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [category, q, sort]);

  return (
    <div className="site-section">
      <div className="container">
        <div className="sm-category-hero"><h1>{q ? `Results for "${q}"` : title}</h1>{blurb && <p>{blurb}</p>}</div>
        <div className="sm-toolbar">
          <div><strong>{loading ? 'Loading…' : `${items.length} product${items.length === 1 ? '' : 's'}`}</strong></div>
          <div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="form-control">
              <option value="">Sort: Newest</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
            </select>
          </div>
        </div>
        {error ? <div className="sm-empty"><h3>Could not load products</h3><p>{error}</p></div>
          : loading ? <div className="row sm-loading">Loading…</div>
          : items.length === 0 ? <div className="sm-empty"><h3>No products found</h3></div>
          : <div className="row">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
      </div>
    </div>
  );
}
