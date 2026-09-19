'use client';
import { Suspense } from 'react';
import CategoryView from '../../components/CategoryView';

export default function MenPage() {
  return (
    <Suspense fallback={<div className="sm-loading">Loading…</div>}>
      <CategoryView category="men" title="Men" blurb="Modern essentials and statement pieces designed for everyday wear." />
    </Suspense>
  );
}
