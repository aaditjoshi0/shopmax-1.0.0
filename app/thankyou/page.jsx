'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function ThankYouInner() {
  const sp = useSearchParams();
  const order = sp.get('order');
  return (
    <div className="site-section"><div className="container">
      <h1>Thank you!</h1>
      {order && <p>Order #{order} placed successfully.</p>}
      <p><Link href="/shop">Continue shopping</Link> · <Link href="/orders">View orders</Link></p>
    </div></div>
  );
}
export default function ThankYouPage() {
  return <Suspense fallback={<div className="container site-section">Loading…</div>}><ThankYouInner /></Suspense>;
}
