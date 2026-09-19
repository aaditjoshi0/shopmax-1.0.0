'use client';
import { Suspense } from 'react';
import CategoryView from '../../components/CategoryView';

export default function WomenPage() {
  return (
    <Suspense fallback={<div className="sm-loading">Loading…</div>}>
      <CategoryView category="women" title="Women" blurb="Contemporary styles crafted for comfort and confidence." />
    </Suspense>
  );
}
