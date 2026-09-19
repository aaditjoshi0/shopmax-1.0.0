'use client';
import { Suspense } from 'react';
import CategoryView from '../../components/CategoryView';

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="sm-loading">Loading…</div>}>
      <CategoryView title="Shop All" blurb="Browse the full collection." />
    </Suspense>
  );
}
