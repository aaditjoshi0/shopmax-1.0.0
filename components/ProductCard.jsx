'use client';
import Link from 'next/link';
import { money } from '../lib/api';

export default function ProductCard({ p }) {
  if (!p) return null;
  const stock = p.stock ?? 0;
  const oos = stock === 0;
  return (
    <div className="col-lg-4 col-md-6 item-entry mb-4">
      <Link href={`/product/${p.id}`} className={'product-item md-height bg-gray d-block' + (oos ? ' sm-product-oos' : '')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.image_url} alt={p.name} className="img-fluid" />
        {oos && <div className="sm-oos-overlay">OUT OF STOCK</div>}
      </Link>
      <h2 className="item-title"><Link href={`/product/${p.id}`}>{p.name}</Link></h2>
      <strong className="item-price">
        {p.compare_at_price && p.compare_at_price > p.price ? (
          <><del>{money(p.compare_at_price)}</del> {money(p.price)}</>
        ) : money(p.price)}
      </strong>
      {oos ? <span className="sm-stock-label sm-out-of-stock">Out of Stock</span>
        : stock <= 5 ? <span className="sm-stock-label sm-low-stock">Only {stock} left</span> : null}
    </div>
  );
}
