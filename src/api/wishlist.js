var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');

// GET /api/wishlist — auth required, returns user's wishlist with product data
router.get('/', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var items = (store.raw.wishlists || [])
        .filter(function (w) { return w.user_id === req.user.id; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      // Attach product data
      var result = items.map(function (w) {
        var product = (store.raw.products || []).find(function (p) { return p.id === w.product_id; });
        return { id: w.id, product_id: w.product_id, created_at: w.created_at, product: product || null };
      }).filter(function (w) { return w.product !== null; });
      return res.json(result);
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data, error } = await sb
      .from('wishlists')
      .select('id, product_id, created_at, products(*)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    var result = (data || []).map(function (w) {
      return { id: w.id, product_id: w.product_id, created_at: w.created_at, product: w.products || null };
    }).filter(function (w) { return w.product !== null; });

    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/wishlist/check?product_id=X — auth required, check single product
router.get('/check', getUser, requireUser, async (req, res, next) => {
  try {
    var productId = req.query.product_id;
    if (!productId) return res.json({ wished: false });

    if (MODE === 'local') {
      var found = (store.raw.wishlists || []).some(function (w) {
        return w.user_id === req.user.id && w.product_id === Number(productId);
      });
      return res.json({ wished: found });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data, error } = await sb
      .from('wishlists')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (error) throw error;
    res.json({ wished: !!data });
  } catch (e) { next(e); }
});

// POST /api/wishlist — auth required, add to wishlist
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var productId = req.body.product_id;
    if (!productId) return res.status(400).json({ error: 'product_id is required' });

    if (MODE === 'local') {
      var existing = (store.raw.wishlists || []).find(function (w) {
        return w.user_id === req.user.id && w.product_id === Number(productId);
      });
      if (existing) return res.json({ ok: true, id: existing.id, wished: true });

      var item = {
        id: (store.raw.wishlists.length || 0) + 1,
        user_id: req.user.id,
        product_id: Number(productId),
        created_at: new Date().toISOString()
      };
      store.raw.wishlists.push(item);
      store.persist();
      return res.json({ ok: true, id: item.id, wished: true });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    // Check if already exists
    var { data: existing2 } = await sb
      .from('wishlists')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing2) return res.json({ ok: true, id: existing2.id, wished: true });

    var { data, error } = await sb
      .from('wishlists')
      .insert({ user_id: req.user.id, product_id: productId })
      .select('id')
      .single();

    if (error) throw error;
    res.json({ ok: true, id: data.id, wished: true });
  } catch (e) { next(e); }
});

// DELETE /api/wishlist/:product_id — auth required, remove from wishlist
router.delete('/:product_id', getUser, requireUser, async (req, res, next) => {
  try {
    var productId = req.params.product_id;

    if (MODE === 'local') {
      var idx = -1;
      for (var i = 0; i < (store.raw.wishlists || []).length; i++) {
        if (store.raw.wishlists[i].user_id === req.user.id && store.raw.wishlists[i].product_id === Number(productId)) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) store.raw.wishlists.splice(idx, 1);
      store.persist();
      return res.json({ ok: true, wished: false });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { error } = await sb
      .from('wishlists')
      .delete()
      .eq('user_id', req.user.id)
      .eq('product_id', productId);

    if (error) throw error;
    res.json({ ok: true, wished: false });
  } catch (e) { next(e); }
});

module.exports = router;
