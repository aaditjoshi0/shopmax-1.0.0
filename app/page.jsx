'use client';
// Home — CSR: all data fetched client-side via /api (no SSG/SSR).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import ProductCard from '../components/ProductCard';

export default function HomePage() {
  const [counts, setCounts] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [rated, setRated] = useState([]);

  useEffect(() => {
    api('/api/products/categories/summary').then(setCounts).catch(() => {});
    api('/api/products?featured=true').then((items) => setFeatured(items.slice(0, 6))).catch(() => {});
    api('/api/products?sort=rating&featured=true').then((items) => setRated(items.slice(0, 4))).catch(() => {});
  }, []);

  return (
    <>
      <div className="site-blocks-cover">
        <div className="container">
          <div className="row">
            <div className="col-md-6 ml-auto order-md-2 align-self-start">
              <div className="site-block-cover-content">
                <h2 className="sub-title">#New Summer Collection 2026</h2>
                <h1>Arrivals Sales</h1>
                <p><Link href="/men" className="btn btn-black rounded-0">Shop Now</Link></p>
              </div>
            </div>
            <div className="col-md-6 order-1 align-self-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/model_3.png" alt="Image" className="img-fluid" />
            </div>
          </div>
        </div>
      </div>

      <div className="site-section">
        <div className="container">
          <div className="title-section mb-5">
            <h2 className="text-uppercase"><span className="d-block">Discover</span> The Collections</h2>
          </div>
          <div className="row align-items-stretch">
            <div className="col-lg-8">
              <div className="product-item sm-height full-height bg-gray">
                <Link href="/women" className="product-category">Women {counts && <span>({counts.women} items)</span>}</Link>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/model_4.png" alt="Image" className="img-fluid" />
              </div>
            </div>
            <div className="col-lg-4">
              <div className="product-item sm-height bg-gray mb-4">
                <Link href="/men" className="product-category">Men {counts && <span>({counts.men} items)</span>}</Link>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/model_5.png" alt="Image" className="img-fluid" />
              </div>
              <div className="product-item sm-height bg-gray">
                <Link href="/shop" className="product-category">Home {counts && <span>({counts.home} items)</span>}</Link>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/model_6.png" alt="Image" className="img-fluid" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="site-section">
        <div className="container">
          <div className="row"><div className="title-section mb-5 col-12"><h2 className="text-uppercase">Popular Products</h2></div></div>
          <div className="row">{featured.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div>
      </div>

      <div className="site-section">
        <div className="container">
          <div className="row"><div className="title-section text-center mb-5 col-12"><h2 className="text-uppercase">Most Rated</h2></div></div>
          <div className="row">{rated.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div>
      </div>
    </>
  );
}
