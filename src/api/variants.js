// Variant + Image CRUD routes (admin), public read.
//
// Variants:  /api/products/:productId/variants
//   GET    -> list all variants for product
//   POST   -> create variant (admin)
//   PUT    /:id -> update variant (admin)
//   DELETE /:id -> remove variant (admin)
//   PATCH  /:id/status -> change status (admin)
//
// Images:   /api/products/:productId/images
//   GET    -> list all images for product
//   POST   -> add image (admin)
//   PUT    /:id -> update image (admin)
//   DELETE /:id -> remove image (admin)

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireAdmin } = require('../middleware/auth');

function getProduct(productId) {
  return store.raw.products.find(p => p.id === Number(productId));
}

// ---------- VARIANTS ----------

// GET /api/products/:productId/variants
router.get('/products/:productId/variants', async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    if (MODE === 'local') {
      return res.json(store.raw.variants.filter(v => v.product_id === pid));
    }
    const { data, error } = await supabase.from('product_variants').select('*').eq('product_id', pid);
    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

// POST /api/products/:productId/variants
router.post('/products/:productId/variants', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const b = req.body || {};
    if (!MODE === 'local' && !getProduct(pid)) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const variant = {
      product_id: pid,
      sku: b.sku || '',
      size: b.size || '',
      color: b.color || '',
      price: Number(b.price) || 0,
      compare_at_price: b.compare_at_price != null ? Number(b.compare_at_price) : null,
      stock: Number(b.stock) || 0,
      status: b.status || 'published'
    };

    if (MODE === 'local') {
      const existing = store.raw.variants.find(v => v.product_id === pid && v.size === variant.size && v.color === variant.color);
      if (existing) return res.status(409).json({ error: 'Variant with that size + color combination already exists for this product.' });
      if (variant.sku) {
        const skuDup = store.raw.variants.find(v => v.sku === variant.sku);
        if (skuDup) return res.status(409).json({ error: 'A variant with that SKU already exists.' });
      }
      variant.id = store.nextId('variant');
      variant.created_at = new Date().toISOString();
      variant.updated_at = variant.created_at;
      store.raw.variants.push(variant);
      store.persist();
      return res.json({ variant });
    }

    const { data, error } = await supabase.from('product_variants').insert(variant).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A variant with that size + color or SKU already exists.' });
      throw error;
    }
    res.json({ variant: data });
  } catch (e) { next(e); }
});

// PUT /api/products/:productId/variants/:id
router.put('/products/:productId/variants/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const vid = Number(req.params.id);
    const b = req.body || {};

    if (MODE === 'local') {
      const v = store.raw.variants.find(x => x.id === vid && x.product_id === pid);
      if (!v) return res.status(404).json({ error: 'Variant not found.' });
      const allowed = ['sku','size','color','price','compare_at_price','stock','status'];
      allowed.forEach(f => { if (b[f] !== undefined) v[f] = b[f]; });
      v.updated_at = new Date().toISOString();
      store.persist();
      return res.json({ variant: v });
    }

    const updates = {};
    ['sku','size','color','price','compare_at_price','stock','status'].forEach(f => {
      if (b[f] !== undefined) updates[f] = b[f];
    });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('product_variants').update(updates).eq('id', vid).eq('product_id', pid).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Variant not found.' });
    res.json({ variant: data });
  } catch (e) { next(e); }
});

// DELETE /api/products/:productId/variants/:id
router.delete('/products/:productId/variants/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const vid = Number(req.params.id);

    if (MODE === 'local') {
      const before = store.raw.variants.length;
      store.raw.variants = store.raw.variants.filter(v => !(v.id === vid && v.product_id === pid));
      store.persist();
      return res.json({ ok: store.raw.variants.length < before });
    }

    const { error } = await supabase.from('product_variants').delete().eq('id', vid).eq('product_id', pid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PATCH /api/products/:productId/variants/:id/status
router.patch('/products/:productId/variants/:id/status', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const vid = Number(req.params.id);
    const { status } = req.body || {};
    const valid = ['published', 'draft', 'hidden'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: 'Status must be one of: ' + valid.join(', ') });
    }

    if (MODE === 'local') {
      const v = store.raw.variants.find(x => x.id === vid && x.product_id === pid);
      if (!v) return res.status(404).json({ error: 'Variant not found.' });
      v.status = status;
      v.updated_at = new Date().toISOString();
      store.persist();
      return res.json({ variant: v });
    }

    const { data, error } = await supabase.from('product_variants').update({ status, updated_at: new Date().toISOString() }).eq('id', vid).eq('product_id', pid).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Variant not found.' });
    res.json({ variant: data });
  } catch (e) { next(e); }
});

// ---------- IMAGES ----------

// GET /api/products/:productId/images
router.get('/products/:productId/images', async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    if (MODE === 'local') {
      const items = store.raw.images.filter(img => img.product_id === pid).sort((a, b) => a.sort_order - b.sort_order);
      return res.json(items);
    }
    const { data, error } = await supabase.from('product_images').select('*').eq('product_id', pid).order('sort_order', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

// POST /api/products/:productId/images
router.post('/products/:productId/images', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const b = req.body || {};

    const img = {
      product_id: pid,
      color: b.color || '',
      url: b.url || '',
      alt: b.alt || '',
      sort_order: b.sort_order != null ? Number(b.sort_order) : 0
    };

    if (!img.url) return res.status(400).json({ error: 'Image URL is required.' });

    if (MODE === 'local') {
      img.id = store.nextId('image');
      img.created_at = new Date().toISOString();
      store.raw.images.push(img);
      store.persist();
      return res.json({ image: img });
    }

    const { data, error } = await supabase.from('product_images').insert(img).select().single();
    if (error) throw error;
    res.json({ image: data });
  } catch (e) { next(e); }
});

// PUT /api/products/:productId/images/:id
router.put('/products/:productId/images/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const iid = Number(req.params.id);
    const b = req.body || {};

    if (MODE === 'local') {
      const img = store.raw.images.find(x => x.id === iid && x.product_id === pid);
      if (!img) return res.status(404).json({ error: 'Image not found.' });
      ['color','url','alt','sort_order'].forEach(f => { if (b[f] !== undefined) img[f] = b[f]; });
      store.persist();
      return res.json({ image: img });
    }

    const updates = {};
    ['color','url','alt','sort_order'].forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    const { data, error } = await supabase.from('product_images').update(updates).eq('id', iid).eq('product_id', pid).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Image not found.' });
    res.json({ image: data });
  } catch (e) { next(e); }
});

// DELETE /api/products/:productId/images/:id
router.delete('/products/:productId/images/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.productId);
    const iid = Number(req.params.id);

    if (MODE === 'local') {
      const before = store.raw.images.length;
      store.raw.images = store.raw.images.filter(img => !(img.id === iid && img.product_id === pid));
      store.persist();
      return res.json({ ok: store.raw.images.length < before });
    }

    const { error } = await supabase.from('product_images').delete().eq('id', iid).eq('product_id', pid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
