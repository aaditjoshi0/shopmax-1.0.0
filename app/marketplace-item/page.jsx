'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

function ItemInner() {
  const sp = useSearchParams();
  const id = sp.get('id');
  const [item, setItem] = useState(null);
  useEffect(() => {
    if (id) api(`/api/marketplace/${id}`).then(setItem).catch(() => {});
  }, [id]);
  if (!item) return <div className="container site-section">Loading…</div>;
  return <div className="site-section"><div className="container"><h1>{item.title}</h1><p>{item.description}</p></div></div>;
}
export default function MarketplaceItemPage() {
  return <Suspense fallback={<div className="container site-section">Loading…</div>}><ItemInner /></Suspense>;
}
