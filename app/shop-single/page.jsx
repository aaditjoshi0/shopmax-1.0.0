'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Legacy shop-single.html -> canonical /product/* route
export default function ShopSinglePage() {
  const router = useRouter();
  useEffect(() => { router.replace('/shop'); }, [router]);
  return <div className="container site-section">Redirecting…</div>;
}
