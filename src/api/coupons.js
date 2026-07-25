// Coupon Management API
// Admin CRUD: /api/admin/coupons
// Validation:  POST /api/cart/validate-coupon
// Analytics:   GET /api/admin/coupons/analytics
//
// Uses the local JSON store for coupon data regardless of DB mode,
// so coupon management works even on Supabase projects without the
// exec_sql RPC / coupons table.

const express = require('express');
const router = express.Router();
const store = require('../db/localStore');
const { getUser, requireAdmin } = require('../middleware/auth');

function now() { return new Date().toISOString(); }

// ---- COUPON VALIDATION (public, for checkout) ----

// POST /api/cart/validate-coupon — validate a coupon code against cart subtotal and user
router.post('/cart/validate-coupon', getUser, async (req, res, next) => {
  try {
    const code = (req.body.code || '').toString().trim().toUpperCase();
    if (!code) return res.status(400).json({ valid: false, error: 'Please enter a coupon code.' });

    const coupon = (store.raw.coupons || []).find(c => c.code === code);
    if (!coupon) return res.json({ valid: false, error: 'Invalid coupon code.' });

    const result = validateCoupon(coupon, req.body.subtotal || 0, req.user);
    res.json(result);
  } catch (e) { next(e); }
});

function validateCoupon(coupon, subtotal, user) {
  const errors = [];
  if (!coupon.active) errors.push('This coupon is no longer active.');
  if (coupon.max_uses > 0 && (coupon.used_count || 0) >= coupon.max_uses) errors.push('This coupon has reached its usage limit.');
  if (coupon.start_date && new Date(coupon.start_date) > new Date()) errors.push('This coupon is not yet active.');
  if (coupon.end_date && new Date(coupon.end_date) < new Date()) errors.push('This coupon has expired.');
  if (subtotal < (coupon.min_cart || 0)) errors.push('Minimum cart value of \u20B9' + coupon.min_cart + ' required for this coupon.');

  if (coupon.first_order_only && user) {
    const userOrders = (store.raw.orders || []).filter(o => o.user_id === user.id && o.status !== 'cancelled');
    if (userOrders.length > 0) errors.push('This coupon is for first-time orders only.');
  }
  if (coupon.per_user_limit > 0 && user) {
    const userUsage = (store.raw.coupon_usage || []).filter(u => u.coupon_code === coupon.code && u.user_id === user.id);
    if (userUsage.length >= coupon.per_user_limit) errors.push('You have reached the usage limit for this coupon.');
  }

  if (errors.length > 0) return { valid: false, error: errors[0] };

  let discount = 0;
  let freeDelivery = !!coupon.free_delivery;
  if (coupon.type === 'percent') discount = Math.round((subtotal * coupon.value) / 100);
  else if (coupon.type === 'fixed') discount = Math.min(coupon.value, subtotal);
  if (coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);

  return { valid: true, coupon: { code: coupon.code, type: coupon.type, value: coupon.value, label: coupon.type === 'percent' ? coupon.value + '% OFF' : coupon.type === 'free_delivery' ? 'FREE DELIVERY' : '\u20B9' + coupon.value + ' OFF', min_cart: coupon.min_cart, max_discount: coupon.max_discount, free_delivery: freeDelivery }, discount, freeDelivery };
}

// ---- ADMIN COUPON CRUD ----

// GET /api/admin/coupons — list all coupons
router.get('/admin/coupons', getUser, requireAdmin, (req, res) => {
  res.json(store.raw.coupons || []);
});

// POST /api/admin/coupons — create a coupon
router.post('/admin/coupons', getUser, requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    if (!b.code) return res.status(400).json({ error: 'Coupon code is required.' });
    const code = b.code.toString().trim().toUpperCase();

    if (store.raw.coupons.find(c => c.code === code)) return res.status(409).json({ error: 'Coupon code already exists.' });

    const coupon = {
      code,
      type: b.type || 'percent',
      value: Number(b.value) || 0,
      min_cart: b.min_cart != null ? Number(b.min_cart) : 0,
      max_discount: b.max_discount != null ? Number(b.max_discount) : 0,
      max_uses: b.max_uses != null ? Number(b.max_uses) : 0,
      per_user_limit: b.per_user_limit != null ? Number(b.per_user_limit) : 0,
      start_date: b.start_date || null,
      end_date: b.end_date || null,
      free_delivery: !!b.free_delivery,
      first_order_only: !!b.first_order_only,
      description: b.description || '',
      active: b.active !== false,
      used_count: 0,
      created_at: now(),
      updated_at: now()
    };
    ['percent', 'fixed', 'free_delivery'].includes(coupon.type) || (coupon.type = 'percent');
    if (coupon.type === 'free_delivery') { coupon.value = 0; coupon.max_discount = 0; }

    store.raw.coupons.push(coupon);
    store.persist();
    res.json({ coupon });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/coupons/:code — update a coupon
router.put('/admin/coupons/:code', getUser, requireAdmin, (req, res) => {
  try {
    const code = req.params.code.toString().trim().toUpperCase();
    const b = req.body || {};
    const c = store.raw.coupons.find(x => x.code === code);
    if (!c) return res.status(404).json({ error: 'Coupon not found.' });

    ['type', 'value', 'min_cart', 'max_discount', 'max_uses', 'per_user_limit', 'description', 'active'].forEach(f => {
      if (b[f] !== undefined) c[f] = b[f];
    });
    if (b.start_date !== undefined) c.start_date = b.start_date;
    if (b.end_date !== undefined) c.end_date = b.end_date;
    if (b.free_delivery !== undefined) c.free_delivery = !!b.free_delivery;
    if (b.first_order_only !== undefined) c.first_order_only = !!b.first_order_only;
    if (c.type === 'free_delivery') { c.value = 0; c.max_discount = 0; }
    c.updated_at = now();

    store.persist();
    res.json({ coupon: c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/coupons/:code — delete a coupon
router.delete('/admin/coupons/:code', getUser, requireAdmin, (req, res) => {
  try {
    const code = req.params.code.toString().trim().toUpperCase();
    const before = store.raw.coupons.length;
    store.raw.coupons = store.raw.coupons.filter(c => c.code !== code);
    store.raw.coupon_usage = (store.raw.coupon_usage || []).filter(u => u.coupon_code !== code);
    store.persist();
    res.json({ ok: store.raw.coupons.length < before });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/coupons/:code/status — toggle active/inactive
router.patch('/admin/coupons/:code/status', getUser, requireAdmin, (req, res) => {
  try {
    const code = req.params.code.toString().trim().toUpperCase();
    const active = req.body.active !== false;
    const c = store.raw.coupons.find(x => x.code === code);
    if (!c) return res.status(404).json({ error: 'Coupon not found.' });
    c.active = active;
    c.updated_at = now();
    store.persist();
    res.json({ coupon: c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/coupons/analytics — coupon analytics
router.get('/admin/coupons/analytics', getUser, requireAdmin, (req, res) => {
  try {
    const coupons = store.raw.coupons || [];
    const usage = store.raw.coupon_usage || [];
    const totalUsage = usage.length;
    const totalDiscount = usage.reduce((s, u) => s + Number(u.discount_amount || 0), 0);
    const topCoupons = coupons.map(c => {
      const cUsage = usage.filter(u => u.coupon_code === c.code);
      const cDiscount = cUsage.reduce((s, u) => s + Number(u.discount_amount || 0), 0);
      return { code: c.code, type: c.type, value: c.value, used_count: c.used_count || 0, discount_given: cDiscount, active: c.active };
    }).sort((a, b) => b.used_count - a.used_count);
    res.json({ totalCoupons: coupons.length, totalUsage, totalDiscount, topCoupons, activeCoupons: coupons.filter(c => c.active).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;