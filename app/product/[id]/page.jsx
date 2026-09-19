'use client';
// Full PDP ported from product.html + js/product.js (same markup/classes,
// same APIs). All internal links are Next routes (no .html).
import Link from 'next/link';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, money } from '../../../lib/api';
import ProductCard from '../../../components/ProductCard';
import {
  accessorySpecsHtml, benefitBadgesHtml, cap, colorDisplay, deliveryReturnsTabHtml,
  escHtml, findVariant, getVariantStock, materialTabHtml, ratingDisplayHtml,
  ratingInputHtml, sizeGuideHtml, starHtml,
} from '../../../lib/pdp';

function discountPct(price, compare) {
  if (compare && compare > price) return Math.round(((compare - price) / compare) * 100);
  return 0;
}

function Inner({ id }) {
  const router = useRouter();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [sizes, setSizes] = useState([]);
  const [colors, setColors] = useState([]);
  const [size, setSize] = useState(null);
  const [color, setColor] = useState(null);
  const [variant, setVariant] = useState(null);
  const [qty, setQty] = useState(1);
  const [mainImg, setMainImg] = useState('');
  const [thumbs, setThumbs] = useState([]);
  const [activeTab, setActiveTab] = useState('tab-desc');
  const [rating, setRating] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [related, setRelated] = useState([]);
  const [recent, setRecent] = useState([]);
  const [wished, setWished] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [msg, setMsg] = useState('');
  const [added, setAdded] = useState(false);
  const [revForm, setRevForm] = useState({ state: 'idle', rating: 5, title: '', text: '' });

  const hasVariants = !!(p && p.variants && p.variants.length > 0);
  const hasImages = !!(p && p.images && p.images.length > 0);

  // ---- load ----
  useEffect(() => {
    setError('');
    api(`/api/products/${id}`)
      .then((prod) => {
        if (!prod || !prod.id) { setError('Product not found.'); return; }
        setP(prod);
        document.title = prod.name + ' — ShopMax';
        try {
          let items = JSON.parse(localStorage.getItem('sm_recently_viewed') || '[]');
          items = items.filter((i) => i.id !== prod.id);
          items.unshift({ id: prod.id, name: prod.name, image_url: prod.image_url, price: prod.price, category: prod.category });
          localStorage.setItem('sm_recently_viewed', JSON.stringify(items.slice(0, 12)));
          setRecent(JSON.parse(localStorage.getItem('sm_recently_viewed') || '[]').filter((i) => i.id !== prod.id).slice(0, 4));
        } catch {}
      })
      .catch(() => setError('Unable to load product. Please try again.'));
    api('/api/auth/me').then((r) => setLoggedIn(!!(r.user))).catch(() => setLoggedIn(false));
    api(`/api/ratings/product/${id}`).then(setRating).catch(() => setRating({ error: true }));
    api(`/api/reviews?product_id=${id}`).then(setReviews).catch(() => {});
    api(`/api/products/${id}/related?limit=4`).then((items) => setRelated(Array.isArray(items) ? items : [])).catch(() => {});
    api(`/api/wishlist/check?product_id=${id}`).then((d) => setWished(!!d.wished)).catch(() => {});
  }, [id]);

  // ---- derive sizes/colors from product ----
  useEffect(() => {
    if (!p) return;
    let s = [], c = [];
    if (hasVariants) {
      p.variants.forEach((v) => { if (v.status === 'published' && v.size && s.indexOf(v.size) === -1) s.push(v.size); });
      if (!s.length) s = p.sizes || ['One Size'];
      c = (p.colors && p.colors.length) ? p.colors : ['Default'];
    } else {
      c = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      s = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    }
    setSizes(s); setColors(c);
    const s0 = s[0] || 'One Size';
    const c0 = c[0] || 'Default';
    setSize(s0); setColor(c0);
    setVariant(hasVariants ? findVariant(p.variants, s0, colorDisplay(c0)) : null);
    setQty(1);
    const filtered = hasImages
      ? (p.images.filter((img) => !img.color || img.color === '' || img.color === colorDisplay(c0)))
      : [];
    const list = filtered.length ? filtered : (hasImages ? p.images : []);
    setThumbs(list);
    setMainImg(list.length ? list[0].url : (p.image_url || ''));
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const dp = variant ? variant.price : (p ? p.price : 0);
  const dc = variant ? variant.compare_at_price : (p ? p.compare_at_price : null);
  const ds = variant ? variant.stock : (p ? p.stock : 0);
  const pct = discountPct(dp, dc);

  function pickColor(c, idx) {
    setColor(hasVariants ? colorDisplay(c) : c);
    const cname = colorDisplay(c);
    if (hasImages) {
      let filtered = p.images.filter((img) => !img.color || img.color === '' || img.color === cname);
      if (!filtered.length) filtered = p.images;
      setThumbs(filtered);
      setMainImg(filtered.length ? filtered[0].url : p.image_url);
    }
    if (hasVariants) {
      const avail = [];
      p.variants.forEach((v) => { if (v.status === 'published' && v.color === cname && v.size && avail.indexOf(v.size) === -1) avail.push(v.size); });
      let s0 = size;
      if (avail.length && avail.indexOf(size) === -1) { s0 = avail[0]; setSize(s0); }
      setVariant(findVariant(p.variants, s0, cname));
      setQty(1);
    } else if (!hasVariants && p.colors && p.colors.length) {
      const obj = p.colors[idx];
      if (obj && obj.image_url) setMainImg(obj.image_url);
    }
  }

  function pickSize(s) {
    if (hasVariants && getVariantStock(p, s, colorDisplay(color)) === 0) return;
    setSize(s);
    if (hasVariants) { setVariant(findVariant(p.variants, s, colorDisplay(color))); setQty(1); }
  }

  function cartPayload() {
    const cname = colorDisplay(color);
    let imgUrl = p.image_url;
    if (hasImages) {
      const f = p.images.filter((img) => !img.color || img.color === '' || img.color === cname);
      imgUrl = f.length ? f[0].url : p.image_url;
    }
    return {
      product_id: p.id,
      variant_id: variant ? variant.id : null,
      name: p.name, price: dp, image_url: imgUrl,
      size, quantity: qty, color: cname,
    };
  }

  async function addToBag(buyNow) {
    setMsg('');
    try {
      await api('/api/cart/items', { method: 'POST', body: JSON.stringify(cartPayload()) });
      try { window.dispatchEvent(new Event('sm-cart-changed')); } catch {}
      if (buyNow) { router.push('/checkout'); return; }
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e) { setMsg(e.message || 'Failed to add to cart'); }
  }

  async function toggleWishlist() {
    if (!loggedIn) { router.push('/login?next=' + encodeURIComponent('/product/' + id)); return; }
    try {
      if (wished) { await api(`/api/wishlist/${id}`, { method: 'DELETE' }); setWished(false); }
      else { await api('/api/wishlist', { method: 'POST', body: JSON.stringify({ product_id: Number(id) }) }); setWished(true); }
      try { window.dispatchEvent(new Event('sm-auth-changed')); } catch {}
    } catch (e) { setMsg(e.message || 'Wishlist failed'); }
  }

  async function submitRating(val) {
    try {
      const data = await api('/api/ratings', { method: 'POST', body: JSON.stringify({ target_type: 'product', target_id: Number(id), rating: val }) });
      setRating(data);
    } catch (e) { setMsg(e.message || 'Failed to save rating'); }
  }

  async function submitReview() {
    if (!revForm.title.trim()) { setMsg('Please enter a title for your review.'); return; }
    if (!revForm.text.trim()) { setMsg('Please write your review.'); return; }
    setRevForm((f) => ({ ...f, state: 'submitting' }));
    try {
      await api('/api/reviews', { method: 'POST', body: JSON.stringify({ product_id: Number(id), rating: revForm.rating, title: revForm.title.trim(), review: revForm.text.trim() }) });
      setRevForm({ state: 'idle', rating: 5, title: '', text: '' });
      api(`/api/reviews?product_id=${id}`).then(setReviews).catch(() => {});
      api(`/api/ratings/product/${id}`).then(setRating).catch(() => {});
    } catch (e) {
      setMsg(e.message || 'Failed to submit review');
      setRevForm((f) => ({ ...f, state: 'idle' }));
    }
  }

  // review eligibility
  useEffect(() => {
    if (!loggedIn || !p) return;
    api(`/api/reviews/eligible?product_id=${id}`)
      .then((elig) => setRevForm((f) => ({ ...f, state: elig.alreadyReviewed ? 'done' : (elig.purchaseEligible ? 'form' : 'locked') })))
      .catch(() => {});
  }, [loggedIn, p, id, reviews === null]);

  const tabs = useMemo(() => {
    if (!p) return [];
    const list = [{ id: 'tab-desc', label: 'Description', content: '<div class="sm-tab-desc">' + ((p.description ? '<p>' + escHtml(p.description) + '</p>' : '<p>No description available.</p>') + (p.details ? '<p>' + escHtml(p.details) + '</p>' : '')) + '</div>' }];
    const specs = accessorySpecsHtml(p);
    if (specs) list.push({ id: 'tab-specs', label: 'Specifications', content: specs });
    list.push(
      { id: 'tab-material', label: 'Material & Care', content: materialTabHtml(p) },
      { id: 'tab-delivery', label: 'Delivery & Returns', content: deliveryReturnsTabHtml(p) },
      { id: 'tab-sizeguide', label: 'Size Guide', content: sizeGuideHtml(p) },
    );
    return list;
  }, [p]);

  if (error) return <div className="container site-section"><div className="sm-empty"><h3>{error}</h3><p><Link href="/shop">Back to Shop</Link></p></div></div>;
  if (!p) return <div className="container site-section"><div id="sm-product-root" className="sm-loading">Loading product...</div></div>;

  const catHref = p.category === 'home' ? '/shop' : '/' + p.category;
  const avg = rating && !rating.error ? (rating.average || 0) : (p.rating || 0);
  const cnt = rating && !rating.error ? (rating.count || 0) : (p.rating_count || 0);

  return (
    <>
      <div className="bg-light py-3">
        <div className="container">
          <div className="row">
            <div className="col-md-12 mb-0">
              <Link href="/">Home</Link><span className="mx-2 mb-0">/</span>
              <Link href={catHref}>{cap(p.category)}</Link><span className="mx-2 mb-0">/</span>
              <strong className="text-black">{p.name}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="site-section sm-pdp-section">
        <div className="container">
          <div className="row sm-pdp-main">
            <div className="col-lg-6 col-md-6 sm-pdp-gallery-col">
              <div className="sm-pdp-main-img-wrap">
                <div
                  className={'sm-pdp-main-img' + (ds === 0 ? ' oos' : '')}
                  onMouseMove={(e) => {
                    const img = e.currentTarget.querySelector('img');
                    if (!img) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    img.style.transformOrigin = (((e.clientX - r.left) / r.width) * 100) + '% ' + (((e.clientY - r.top) / r.height) * 100) + '%';
                    img.style.transform = 'scale(2)';
                  }}
                  onMouseLeave={(e) => {
                    const img = e.currentTarget.querySelector('img');
                    if (img) { img.style.transformOrigin = 'center center'; img.style.transform = 'scale(1)'; }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mainImg} alt={p.name} className="img-fluid" />
                  {ds === 0 && <div className="sm-pdp-oos-badge">OUT OF STOCK</div>}
                </div>
              </div>
              {thumbs.length > 1 && (
                <div className="sm-pdp-thumbs">
                  {thumbs.map((img, i) => (
                    <button key={i} type="button" className={'sm-pdp-thumb' + (img.url === mainImg ? ' active' : '')} onClick={() => setMainImg(img.url)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.alt || ''} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="col-lg-6 col-md-6 sm-pdp-info-col">
              {p.brand && <div className="sm-pdp-brand">{p.brand}</div>}
              <h1 className="sm-pdp-name">{p.name}</h1>
              <div className="sm-pdp-rating-row">
                {rating && !rating.error ? (
                  <div className="sm-pdp-rating-section">
                    {cnt === 0 ? (
                      <>
                        <div className="sm-rating-display"><span className="sm-rating-stars">
                          {[1, 2, 3, 4, 5].map((i) => <span key={i} className="icon-star2 text-muted"></span>)}
                        </span></div>
                        <div className="sm-no-ratings-text">No Ratings Yet</div>
                        {loggedIn ? (
                          <>
                            <div className="sm-no-ratings-sub">Be the first to rate this product.</div>
                            <div className="sm-pdp-rate-this"><div className="sm-rating-interactive"
                              onClick={(e) => { const s = e.target.closest('.sm-rating-star'); if (s) submitRating(Number(s.getAttribute('data-val'))); }}
                              dangerouslySetInnerHTML={{ __html: ratingInputHtml(0) }} /></div>
                          </>
                        ) : <div className="sm-no-ratings-sub">Please sign in to rate this product.</div>}
                      </>
                    ) : (
                      <>
                        <div className="sm-pdp-rating-summary" dangerouslySetInnerHTML={{ __html: ratingDisplayHtml(avg, cnt) }} />
                        {loggedIn ? (
                          <div className="sm-pdp-rate-this">
                            <label className="sm-rate-label">Rate this Product:</label>
                            <div className="sm-rating-interactive"
                              onClick={(e) => { const s = e.target.closest('.sm-rating-star'); if (s) submitRating(Number(s.getAttribute('data-val'))); }}
                              dangerouslySetInnerHTML={{ __html: ratingInputHtml(rating.userRating || 0) }} />
                          </div>
                        ) : (
                          <div className="sm-pdp-rate-login"><Link href={'/login?next=' + encodeURIComponent('/product/' + id)}>Sign in</Link> to rate this product.</div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: ratingDisplayHtml(p.rating, p.rating_count || 0) }} />
                )}
                <a href="#sm-reviews" className="sm-pdp-review-count"
                  onClick={(e) => { e.preventDefault(); document.getElementById('sm-reviews')?.scrollIntoView({ behavior: 'smooth' }); }}>
                  Reviews</a>
              </div>

              <div className="sm-pdp-price">
                <span className="sm-pdp-price-current">{money(dp)}</span>
                {dc && dc > dp && (
                  <>
                    <span className="sm-pdp-price-compare"><del>{money(dc)}</del></span>
                    <span className="sm-pdp-price-discount">-{pct}%</span>
                  </>
                )}
              </div>
              {ds !== 0 && (ds <= 5
                ? <div className="sm-pdp-stock low">Hurry! Only {ds} left in stock.</div>
                : <div className="sm-pdp-stock in">In Stock</div>)}

              {p.description && <p className="sm-pdp-desc">{p.description}</p>}
              <div className="sm-pdp-divider"></div>

              <div className="sm-pdp-option">
                <label className="sm-pdp-option-label">Color: <span>{colorDisplay(color)}</span></label>
                <div className="sm-pdp-colors">
                  {colors.map((c, i) => {
                    const name = colorDisplay(c);
                    const hex = typeof c === 'object' && c !== null ? c.hex : '#cccccc';
                    const active = hasVariants ? (name === colorDisplay(color)) : (i === colors.indexOf(color));
                    return (
                      <button key={i} type="button" className={'sm-pdp-color' + (active ? ' active' : '')} title={name} onClick={() => pickColor(hasVariants ? name : c, i)}>
                        <span className="sm-pdp-color-swatch" style={{ background: hex }}></span>
                        <span className="sm-pdp-color-label">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sm-pdp-option">
                <div className="sm-pdp-size-header">
                  <label className="sm-pdp-option-label">Size</label>
                  <a href="#sizeguide" className="sm-pdp-size-guide-link"
                    onClick={(e) => { e.preventDefault(); setActiveTab('tab-sizeguide'); document.getElementById('sm-tabs')?.scrollIntoView({ behavior: 'smooth' }); }}>
                    Size Guide</a>
                </div>
                <div className="sm-pdp-sizes">
                  {sizes.map((s) => {
                    const oos = hasVariants && getVariantStock(p, s, colorDisplay(color)) === 0;
                    return (
                      <button key={s} type="button" className={'sm-pdp-size' + (s === size ? ' active' : '') + (oos ? ' oos' : '')}
                        title={oos ? 'Out of stock' : ''} onClick={() => pickSize(s)}>{s}</button>
                    );
                  })}
                </div>
              </div>

              <div className="sm-pdp-option">
                <label className="sm-pdp-option-label">Quantity</label>
                <div className="sm-pdp-qty">
                  <button type="button" className="sm-pdp-qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>-</button>
                  <span className="sm-pdp-qty-val">{qty}</span>
                  <button type="button" className="sm-pdp-qty-btn" onClick={() => setQty((q) => Math.min((variant ? variant.stock : p.stock) || 999, q + 1))}>+</button>
                </div>
              </div>

              <div className="sm-pdp-actions">
                <div className="sm-pdp-action-main">
                  <button type="button" className={'sm-pdp-addcart' + (ds === 0 ? ' oos' : '') + (added ? ' sm-added' : '')}
                    disabled={ds === 0} onClick={() => addToBag(false)}>
                    {ds === 0 ? 'Out of Stock' : (added ? '✓ Added!' : 'Add to Bag')}
                  </button>
                  <button type="button" className={'sm-pdp-buynow' + (ds === 0 ? ' oos' : '')} disabled={ds === 0} onClick={() => addToBag(true)}>Buy Now</button>
                </div>
                <button type="button" className={'sm-pdp-wishlist' + (wished ? ' wished' : '')} title="Add to Wishlist" onClick={toggleWishlist}>
                  <span className="sm-pdp-wishlist-icon">{wished ? '♥' : '♡'}</span>
                </button>
              </div>
              {msg && <p className="mt-2 text-danger">{msg}</p>}

              {p.tags && p.tags.length > 0 && (
                <div className="sm-pdp-tags">
                  {p.tags.map((t) => <Link key={t} href={'/shop?q=' + encodeURIComponent(t)} className="sm-pdp-tag">{t}</Link>)}
                </div>
              )}
              <div className="sm-pdp-benefits" dangerouslySetInnerHTML={{ __html: benefitBadgesHtml(p.benefits) }} />
              {p.sku && <div className="sm-pdp-sku">SKU: {p.sku}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="container sm-pdp-tabs-section" id="sm-tabs">
        <ul className="nav sm-pdp-tabs">
          {tabs.map((t) => (
            <li key={t.id}><a href={'#' + t.id} className={activeTab === t.id ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setActiveTab(t.id); }}>{t.label}</a></li>
          ))}
        </ul>
        <div className="sm-pdp-tab-content">
          {tabs.map((t) => (
            <div key={t.id} className={'sm-pdp-tab-panel' + (activeTab === t.id ? ' active' : '')}
              dangerouslySetInnerHTML={activeTab === t.id ? { __html: t.content } : undefined} />
          ))}
        </div>
      </div>

      <div className="container sm-pdp-reviews-section" id="sm-reviews">
        <h3 className="sm-pdp-section-title">Customer Reviews</h3>
        {reviews && (
          <>
            <div dangerouslySetInnerHTML={{
              __html: '<div class="sm-reviews-summary"><div class="sm-reviews-avg">' +
                '<span class="sm-reviews-avg-num">' + (Number(reviews.average || 0)).toFixed(1) + '</span>' +
                '<div class="sm-reviews-avg-stars">' + starHtml(reviews.average || 0) + '</div>' +
                '<span class="sm-reviews-avg-count">' + (reviews.count || 0) + ' review' + ((reviews.count || 0) !== 1 ? 's' : '') + '</span>' +
                '</div></div>',
            }} />
            <div>
              {(reviews.reviews || []).map((r) => (
                <div key={r.id} className="sm-review-item">
                  <div className="sm-review-header">
                    <div className="sm-review-stars" dangerouslySetInnerHTML={{ __html: starHtml(r.rating) }} />
                    <span className="sm-review-author">{r.user_name || 'Anonymous'}</span>
                    {r.verified_purchase && <span className="sm-review-verified">Verified Purchase</span>}
                    <span className="sm-review-date">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                  </div>
                  {r.title && <div className="sm-review-title">{r.title}</div>}
                  {r.review && <div className="sm-review-body">{r.review}</div>}
                </div>
              ))}
              {!(reviews.reviews || []).length && <p className="text-muted">No reviews yet. Be the first to review this product!</p>}
            </div>
            {loggedIn ? (
              revForm.state === 'form' ? (
                <div className="sm-review-form-wrap">
                  <h4>Write a Review</h4>
                  <div className="sm-review-form">
                    <div className="sm-review-form-rating">
                      <label>Your Rating:</label>
                      <div>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className={'sm-review-star' + (n <= revForm.rating ? ' active' : '')}
                            style={{ cursor: 'pointer' }}
                            onClick={() => setRevForm((f) => ({ ...f, rating: n }))}>★</span>
                        ))}
                      </div>
                    </div>
                    <div className="sm-review-form-group">
                      <label>Title</label>
                      <input type="text" className="form-control" placeholder="Summarize your review" maxLength={200}
                        value={revForm.title} onChange={(e) => setRevForm((f) => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="sm-review-form-group">
                      <label>Your Review</label>
                      <textarea className="form-control" rows={4} placeholder="Share your experience..." maxLength={2000}
                        value={revForm.text} onChange={(e) => setRevForm((f) => ({ ...f, text: e.target.value }))} />
                    </div>
                    <button type="button" className="btn btn-primary" disabled={revForm.state === 'submitting'} onClick={submitReview}>
                      {revForm.state === 'submitting' ? 'Submitting...' : 'Submit Review'}
                    </button>
                  </div>
                </div>
              ) : revForm.state === 'done' ? <p className="text-muted">You have already reviewed this product.</p>
                : revForm.state === 'locked' ? <p className="text-muted">You can review this product after it has been delivered to you.</p>
                : <p className="text-muted">Checking your eligibility...</p>
            ) : (
              <div className="sm-review-login"><Link href={'/login?next=' + encodeURIComponent('/product/' + id)}>Sign in</Link> to write a review.</div>
            )}
          </>
        )}
      </div>

      {related.length > 0 && (
        <div className="container sm-pdp-related-section">
          <h3 className="sm-pdp-section-title">You May Also Like</h3>
          <div className="row">{related.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="container sm-pdp-recent-section">
          <h3 className="sm-pdp-section-title">Recently Viewed</h3>
          <div className="row">
            {recent.map((item) => (
              <div key={item.id} className="col-lg-3 col-md-4 col-6 mb-4">
                <Link href={'/product/' + item.id} className="product-item md-height bg-gray d-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.image_url || ''} alt={item.name} className="img-fluid" />
                </Link>
                <h2 className="item-title"><Link href={'/product/' + item.id}>{item.name}</Link></h2>
                <div className="sm-current-price">{money(item.price)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function ProductPage({ params }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="container site-section sm-loading">Loading product…</div>}>
      <Inner id={id} />
    </Suspense>
  );
}
