var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');

// GET /api/reviews?product_id=X — public
router.get('/', getUser, async (req, res, next) => {
  try {
    var productId = req.query.product_id;
    if (!productId) return res.status(400).json({ error: 'product_id is required' });

    if (MODE === 'local') {
      var reviews = (store.raw.reviews || [])
        .filter(function (r) { return String(r.product_id) === String(productId); })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var avg = 0;
      if (reviews.length) {
        avg = reviews.reduce(function (s, r) { return s + (r.rating || 0); }, 0) / reviews.length;
      }
      return res.json({ reviews: reviews, average: Math.round(avg * 10) / 10, count: reviews.length });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data, error } = await sb
      .from('reviews')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    var reviews = data || [];
    var avg = 0;
    if (reviews.length) {
      avg = reviews.reduce(function (s, r) { return s + (r.rating || 0); }, 0) / reviews.length;
    }
    res.json({ reviews: reviews, average: Math.round(avg * 10) / 10, count: reviews.length });
  } catch (e) { next(e); }
});

// POST /api/reviews — auth required
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var { product_id, rating, title, comment } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id is required' });
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    title = (title || '').toString().trim().substring(0, 200);
    comment = (comment || '').toString().trim().substring(0, 2000);

    if (MODE === 'local') {
      var existing = (store.raw.reviews || []).find(function (r) {
        return String(r.product_id) === String(product_id) && r.user_id === req.user.id;
      });
      if (existing) {
        existing.rating = rating;
        existing.title = title;
        existing.comment = comment;
        existing.created_at = new Date().toISOString();
        store.persist();
        return res.json(existing);
      }

      var review = {
        id: (store.raw.reviews.length || 0) + 1,
        product_id: Number(product_id),
        user_id: req.user.id,
        user_name: req.user.name || req.user.email || 'Anonymous',
        rating: Number(rating),
        title: title,
        comment: comment,
        created_at: new Date().toISOString()
      };
      store.raw.reviews.push(review);
      store.persist();
      return res.json(review);
    }

    var sb = getServiceClient() || req.supabase || supabase;
    // Upsert: one review per user per product
    var { data: existing2 } = await sb
      .from('reviews')
      .select('id')
      .eq('product_id', product_id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    var review2;
    if (existing2) {
      var { data, error } = await sb
        .from('reviews')
        .update({ rating: Number(rating), title: title, comment: comment, created_at: new Date().toISOString() })
        .eq('id', existing2.id)
        .select()
        .single();
      if (error) throw error;
      review2 = data;
    } else {
      var { data, error } = await sb
        .from('reviews')
        .insert({
          product_id: Number(product_id),
          user_id: req.user.id,
          user_name: req.user.name || req.user.email || 'Anonymous',
          rating: Number(rating),
          title: title,
          comment: comment
        })
        .select()
        .single();
      if (error) throw error;
      review2 = data;
    }
    res.json(review2);
  } catch (e) { next(e); }
});

// DELETE /api/reviews/:id — owner only
router.delete('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    var id = req.params.id;

    if (MODE === 'local') {
      var idx = -1;
      for (var i = 0; i < (store.raw.reviews || []).length; i++) {
        if (store.raw.reviews[i].id === Number(id) && store.raw.reviews[i].user_id === req.user.id) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return res.status(404).json({ error: 'Review not found' });
      store.raw.reviews.splice(idx, 1);
      store.persist();
      return res.json({ ok: true });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { error } = await sb
      .from('reviews')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
