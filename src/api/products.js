// GET /api/products              -> list, optional ?category=&q=&featured=&sort=&status=&admin=&bestseller=&new_arrival=
// GET /api/products/:id          -> single product
// GET /api/products/slugs/:slug  -> single product by slug
// GET /api/products/categories/summary -> counts per category
// POST /api/products             -> create product (admin)
// PUT /api/products/:id          -> update product (admin)
// DELETE /api/products/:id       -> delete product (admin)
// PATCH /api/products/:id/status -> update product status (admin)
// POST /api/products/:id/duplicate -> duplicate product (admin)

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireAdmin } = require('../middleware/auth');

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
}

function uniqueSlug(base) {
  return base + '-' + crypto.randomBytes(4).toString('hex');
}

function localList({ category, q, featured, sort, status, bestseller, new_arrival, admin }) {
  let items = store.raw.products.slice();
  if (!admin) {
    items = items.filter(p => (p.status || 'published') === 'published');
  }
  if (category) items = items.filter(p => p.category === category);
  if (featured === 'true') items = items.filter(p => p.featured);
  if (bestseller === 'true') items = items.filter(p => p.bestseller);
  if (new_arrival === 'true') items = items.filter(p => p.new_arrival);
  if (status) items = items.filter(p => (p.status || 'published') === status);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(p =>
      p.name.toLowerCase().includes(needle) ||
      (p.description || '').toLowerCase().includes(needle) ||
      (p.sku || '').toLowerCase().includes(needle) ||
      (p.brand || '').toLowerCase().includes(needle)
    );
  }
  switch (sort) {
    case 'price-asc':  items.sort((a, b) => a.price - b.price); break;
    case 'price-desc': items.sort((a, b) => b.price - a.price); break;
    case 'rating':     items.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    default:           items.sort((a, b) => a.id - b.id);
  }
  return items;
}

async function supabaseList({ category, q, featured, sort, status, bestseller, new_arrival, admin }) {
  let query = supabase.from('products').select('*');
  if (category) query = query.eq('category', category);
  if (featured === 'true') query = query.eq('featured', true);
  if (bestseller === 'true') query = query.eq('bestseller', true);
  if (new_arrival === 'true') query = query.eq('new_arrival', true);
  // Public queries see only published products; admin queries see all
  if (!admin) {
    query = query.or('status.eq.published,status.is.null');
  } else if (status) {
    query = query.eq('status', status);
  }
  if (q) {
    const needle = q.toLowerCase();
    query = query.or(`name.ilike.%${needle}%,description.ilike.%${needle}%,sku.ilike.%${needle}%,brand.ilike.%${needle}%`);
  }
  switch (sort) {
    case 'price-asc':  query = query.order('price', { ascending: true }); break;
    case 'price-desc': query = query.order('price', { ascending: false }); break;
    case 'rating':     query = query.order('rating', { ascending: false }); break;
    default:           query = query.order('id', { ascending: false });
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// GET /api/products/categories/summary
router.get('/categories/summary', async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const counts = { men: 0, women: 0, home: 0 };
      store.raw.products.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
      return res.json(counts);
    }
    const { data, error } = await supabase.rpc('category_counts');
    if (error) {
      // fallback if RPC missing
      const { data: all } = await supabase.from('products').select('category');
      const counts = { men: 0, women: 0, home: 0 };
      (all || []).forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
      return res.json(counts);
    }
    res.json(data);
  } catch (e) { next(e); }
});

// GET /api/products
router.get('/', async (req, res, next) => {
  try {
    const { category, q, featured, sort, status, bestseller, new_arrival, admin } = req.query;
    const items = MODE === 'local'
      ? localList({ category, q, featured, sort, status, bestseller, new_arrival, admin })
      : await supabaseList({ category, q, featured, sort, status, bestseller, new_arrival, admin });
    res.json(items);
  } catch (e) { next(e); }
});

// GET /api/products/slugs/:slug
router.get('/slugs/:slug', async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const item = store.raw.products.find(p => p.slug === req.params.slug);
      if (!item) return res.status(404).json({ error: 'Product not found' });
      return res.json(item);
    }
    const { data, error } = await supabase.from('products').select('*').eq('slug', req.params.slug).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json(data);
  } catch (e) { next(e); }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (MODE === 'local') {
      const item = store.raw.products.find(p => p.id === id);
      if (!item) return res.status(404).json({ error: 'Product not found' });
      const variants = store.raw.variants.filter(v => v.product_id === id);
      const images = store.raw.images.filter(img => img.product_id === id).sort((a, b) => a.sort_order - b.sort_order);
      const stock = variants.length ? variants.reduce((s, v) => s + (v.stock || 0), 0) : item.stock;
      const sizes = variants.length ? [...new Set(variants.filter(v => v.size).map(v => v.size))] : item.sizes;
      const colors = variants.length ? [...new Set(variants.filter(v => v.color).map(v => v.color))] : item.colors;
      return res.json({ ...item, variants, images, stock, sizes, colors });
    }
    const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found' });
    const [variants, images] = await Promise.all([
      supabase.from('product_variants').select('*').eq('product_id', id).then(r => r.data || []),
      supabase.from('product_images').select('*').eq('product_id', id).order('sort_order', { ascending: true }).then(r => r.data || [])
    ]);
    const stock = variants.length ? variants.reduce((s, v) => s + (v.stock || 0), 0) : data.stock;
    const sizes = variants.length ? [...new Set(variants.filter(v => v.size).map(v => v.size))] : (data.sizes || []);
    const colors = variants.length ? [...new Set(variants.filter(v => v.color).map(v => v.color))] : (data.colors || []);
    res.json({ ...data, variants, images, stock, sizes, colors });
  } catch (e) { next(e); }
});

// POST /api/products — create product (admin)
router.post('/', getUser, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Product name is required.' });

    const slug = toSlug(b.name);
    const now = new Date().toISOString();
    const product = {
      name: b.name,
      slug,
      description: b.description || '',
      price: Number(b.price) || 0,
      compare_at_price: b.compare_at_price != null ? Number(b.compare_at_price) : null,
      category: b.category || 'uncategorized',
      image_url: b.image_url || '',
      stock: Number(b.stock) || 0,
      sizes: b.sizes || [],
      rating: Number(b.rating) || 0,
      featured: !!b.featured,
      colors: b.colors || null,
      brand: b.brand || '',
      sku: b.sku || '',
      tags: b.tags || [],
      status: b.status || 'draft',
      gender: b.gender || 'unisex',
      bestseller: !!b.bestseller,
      new_arrival: !!b.new_arrival,
      discount_price: b.discount_price != null ? Number(b.discount_price) : null
    };

    if (MODE === 'local') {
      const existing = store.raw.products.find(p => p.sku && p.sku === product.sku);
      if (product.sku && existing) return res.status(409).json({ error: 'A product with that SKU already exists.' });
      const id = store.nextId('product');
      product.id = id;
      product.created_at = now;
      product.updated_at = now;
      // Ensure unique slug
      if (store.raw.products.find(p => p.slug === product.slug)) {
        product.slug = uniqueSlug(product.slug);
      }
      store.raw.products.push(product);
      store.persist();
      return res.json({ product });
    }

    // Supabase
    const { data, error } = await supabase.from('products').insert({
      ...product,
      created_by: req.user.id,
      created_at: now,
      updated_at: now
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A product with that SKU or slug already exists.' });
      throw error;
    }
    res.json({ product: data });
  } catch (e) { next(e); }
});

// PUT /api/products/:id — update product (admin)
router.put('/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};

    if (MODE === 'local') {
      const p = store.raw.products.find(p => p.id === id);
      if (!p) return res.status(404).json({ error: 'Product not found.' });
      const fields = ['name','description','price','compare_at_price','category','image_url','stock','sizes','rating','featured','colors','brand','sku','tags','status','gender','bestseller','new_arrival','discount_price'];
      fields.forEach(f => {
        if (b[f] !== undefined) p[f] = b[f];
      });
      if (b.name) {
        const newSlug = toSlug(b.name);
        const dup = store.raw.products.find(x => x.slug === newSlug && x.id !== id);
        p.slug = dup ? uniqueSlug(newSlug) : newSlug;
      }
      p.updated_at = new Date().toISOString();
      store.persist();
      return res.json({ product: p });
    }

    const updates = {};
    const allowed = ['name','description','price','compare_at_price','category','image_url','stock','sizes','rating','featured','colors','brand','sku','tags','status','gender','bestseller','new_arrival','discount_price'];
    allowed.forEach(f => {
      if (b[f] !== undefined) updates[f] = b[f];
    });
    if (b.name) {
      updates.slug = toSlug(b.name);
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A product with that SKU or slug already exists.' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: data });
  } catch (e) { next(e); }
});

// DELETE /api/products/:id — delete product (admin)
router.delete('/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (MODE === 'local') {
      const before = store.raw.products.length;
      store.raw.products = store.raw.products.filter(p => p.id !== id);
      store.persist();
      return res.json({ ok: store.raw.products.length < before });
    }
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PATCH /api/products/:id/status — update product status (admin)
router.patch('/:id/status', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    const valid = ['published', 'draft', 'hidden', 'inactive'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: 'Status must be one of: ' + valid.join(', ') });
    }

    if (MODE === 'local') {
      const p = store.raw.products.find(p => p.id === id);
      if (!p) return res.status(404).json({ error: 'Product not found.' });
      p.status = status;
      p.updated_at = new Date().toISOString();
      store.persist();
      return res.json({ product: p });
    }

    const { data, error } = await supabase.from('products').update({
      status, updated_at: new Date().toISOString()
    }).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: data });
  } catch (e) { next(e); }
});

// POST /api/products/:id/duplicate — duplicate product (admin)
router.post('/:id/duplicate', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (MODE === 'local') {
      const orig = store.raw.products.find(p => p.id === id);
      if (!orig) return res.status(404).json({ error: 'Product not found.' });
      const newId = store.nextId('product');
      const dup = JSON.parse(JSON.stringify(orig));
      dup.id = newId;
      dup.name = orig.name + ' (Copy)';
      dup.slug = uniqueSlug(toSlug(dup.name));
      dup.status = 'draft';
      dup.sku = dup.sku ? dup.sku + '-copy' : '';
      dup.created_at = new Date().toISOString();
      dup.updated_at = dup.created_at;
      store.raw.products.push(dup);
      store.persist();
      return res.json({ product: dup });
    }

    // Supabase
    const { data: orig, error: fetchErr } = await supabase.from('products').select('*').eq('id', id).single();
    if (fetchErr || !orig) return res.status(404).json({ error: 'Product not found.' });

    const dup = { ...orig };
    delete dup.id;
    dup.name = orig.name + ' (Copy)';
    dup.slug = uniqueSlug(toSlug(dup.name));
    dup.status = 'draft';
    dup.sku = dup.sku ? dup.sku + '-copy' : '';
    delete dup.created_at;
    dup.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('products').insert(dup).select().single();
    if (error) throw error;
    res.json({ product: data });
  } catch (e) { next(e); }
});

module.exports = router;
