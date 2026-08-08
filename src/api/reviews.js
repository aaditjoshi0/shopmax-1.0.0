var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');

function isDelivered(o) {
  return o && String(o.status || '').toLowerCase() === 'delivered';
}

function hasDeliveredOrderForProductLocal(userId, productId) {
  var orders = store.raw.orders || [];
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].user_id !== userId) continue;
    if (!isDelivered(orders[i])) continue;
    var items = orders[i].items || [];
    for (var j = 0; j < items.length; j++) {
      if (String(items[j].product_id) === String(productId)) return true;
    }
  }
  return false;
}

function findDeliveredOrderLocal(userId, productId, orderId) {
  var orders = store.raw.orders || [];
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o.user_id !== userId) continue;
    if (orderId && String(o.id) !== String(orderId)) continue;
    if (!isDelivered(o)) continue;
    var items = o.items || [];
    for (var j = 0; j < items.length; j++) {
      if (String(items[j].product_id) === String(productId)) return o;
    }
  }
  return null;
}

async function findDeliveredOrderSupabase(sb, userId, productId, orderId) {
  var q = sb.from('orders').select('id, status, items');
  if (orderId) q = q.eq('id', orderId);
  var { data } = await q.eq('user_id', userId);
  var orders = data || [];
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (!isDelivered(o)) continue;
    var items = o.items || [];
    for (var j = 0; j < items.length; j++) {
      if (String(items[j].product_id) === String(productId)) return o;
    }
  }
  return null;
}

function recalcProductRatingLocal(productId) {
  var ratings = (store.raw.ratings || []).filter(function (r) {
    return r.target_type === 'product' && String(r.target_id) === String(productId);
  });
  var count = ratings.length;
  var avg = 0;
  if (count) {
    avg = ratings.reduce(function (s, r) { return s + r.rating; }, 0) / count;
    avg = Math.round(avg * 10) / 10;
  }
  var product = store.raw.products.find(function (p) { return String(p.id) === String(productId); });
  if (product) {
    product.rating = count ? avg : (product.rating || 0);
    product.rating_count = count;
    store.persist();
  }
}

async function supabaseRecalcProduct(targetId) {
  var sb = getServiceClient() || supabase;
  var { data } = await sb.from('ratings').select('rating').eq('target_type', 'product').eq('target_id', targetId);
  var r = data || [];
  var count = r.length;
  var avg = 0;
  if (count) {
    avg = r.reduce(function (s, x) { return s + x.rating; }, 0) / count;
    avg = Math.round(avg * 10) / 10;
  }
  await sb.from('products').update({
    rating: count ? avg : 0,
    rating_count: count,
    updated_at: new Date().toISOString()
  }).eq('id', targetId);
  return { average: avg, count: count };
}

async function syncRatingForReview(userId, productId, rating) {
  if (MODE === 'local') {
    var existing = (store.raw.ratings || []).find(function (r) {
      return r.target_type === 'product' && String(r.target_id) === String(productId) && r.user_id === userId;
    });
    if (existing) {
      existing.rating = rating;
      existing.updated_at = new Date().toISOString();
    } else {
      store.raw.ratings.push({
        id: (store.raw.ratings.length || 0) + 1,
        target_type: 'product',
        target_id: Number(productId),
        user_id: userId,
        rating: Number(rating),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    store.persist();
    recalcProductRatingLocal(productId);
    return null;
  }
  var sb = getServiceClient() || supabase;
  var { data: existing2 } = await sb.from('ratings').select('id').eq('target_type', 'product').eq('target_id', productId).eq('user_id', userId).maybeSingle();
  if (existing2) {
    await sb.from('ratings').update({ rating: Number(rating), updated_at: new Date().toISOString() }).eq('id', existing2.id);
  } else {
    await sb.from('ratings').insert({ target_type: 'product', target_id: Number(productId), user_id: userId, rating: Number(rating) });
  }
  return supabaseRecalcProduct(productId);
}

// Shared create-review logic (used by POST /api/reviews and POST /api/orders/:id/review)
// data: { product_id, rating, title, review, order_id, verified_order }
// Returns { review } on success, or { status, error } on validation/duplicate failure.
async function submitReview(user, data) {
  var productId = data.product_id;
  var nRating = Number(data.rating);
  if (!productId) return { status: 400, error: 'product_id is required' };
  if (!nRating || nRating < 1 || nRating > 5) return { status: 400, error: 'Rating must be between 1 and 5' };
  var title = (data.title || '').toString().trim().substring(0, 200);
  if (!title) return { status: 400, error: 'Title is required' };
  var reviewText = (data.review || '').toString().trim().substring(0, 2000);
  if (!reviewText) return { status: 400, error: 'Review is required' };

  // Duplicate check: one review per user per product
  if (MODE === 'local') {
    var dupLocal = (store.raw.reviews || []).find(function (r) {
      return String(r.product_id) === String(productId) && r.user_id === user.id;
    });
    if (dupLocal) {
      return { status: 409, error: 'You have already reviewed this product.' };
    }
  } else {
    var sbDup = getServiceClient() || supabase;
    var { data: existing } = await sbDup
      .from('reviews')
      .select('id')
      .eq('product_id', productId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      return { status: 409, error: 'You have already reviewed this product.' };
    }
  }

  var review;
  if (MODE === 'local') {
    review = {
      id: (store.raw.reviews.length || 0) + 1,
      product_id: Number(productId),
      user_id: user.id,
      order_id: data.verified_order ? Number(data.verified_order.id) : (data.order_id ? Number(data.order_id) : null),
      user_name: user.name || user.email || 'Anonymous',
      rating: nRating,
      title: title,
      review: reviewText,
      verified_purchase: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    store.raw.reviews.push(review);
    store.persist();
  } else {
    var sb = getServiceClient() || supabase;
    var { data: inserted, error } = await sb
      .from('reviews')
      .insert({
        product_id: Number(productId),
        user_id: user.id,
        order_id: data.verified_order ? Number(data.verified_order.id) : (data.order_id ? Number(data.order_id) : null),
        user_name: user.name || user.email || 'Anonymous',
        rating: nRating,
        title: title,
        review: reviewText,
        verified_purchase: true
      })
      .select()
      .single();
    if (error) throw error;
    review = inserted;
  }

  // Keep the product rating in sync (review implies a rating)
  try {
    await syncRatingForReview(user.id, productId, nRating);
  } catch (e) {
    console.warn('[reviews] rating sync failed:', e.message);
  }

  return { review: review };
}

// GET /api/reviews/eligible?product_id=X — auth required
// Tells the UI whether the current user may review this product
router.get('/eligible', getUser, requireUser, async (req, res, next) => {
  try {
    var productId = req.query.product_id;
    if (!productId) return res.status(400).json({ error: 'product_id is required' });

    var purchaseEligible = false;
    if (MODE === 'local') {
      purchaseEligible = hasDeliveredOrderForProductLocal(req.user.id, productId);
    } else {
      var sb0 = req.supabase || supabase;
      var found0 = await findDeliveredOrderSupabase(sb0, req.user.id, productId, null);
      purchaseEligible = !!found0;
    }

    var alreadyReviewed = false;
    if (MODE === 'local') {
      alreadyReviewed = !!(store.raw.reviews || []).find(function (r) {
        return String(r.product_id) === String(productId) && r.user_id === req.user.id;
      });
    } else {
      var sb1 = getServiceClient() || req.supabase || supabase;
      var { data: mine } = await sb1.from('reviews').select('id').eq('product_id', productId).eq('user_id', req.user.id).maybeSingle();
      alreadyReviewed = !!mine;
    }

    res.json({ eligible: purchaseEligible && !alreadyReviewed, purchaseEligible: purchaseEligible, alreadyReviewed: alreadyReviewed });
  } catch (e) { next(e); }
});

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
// Rules: rating 1-5, title and review text required, product must exist,
// user must have a DELIVERED order containing the product, one review per user per product.
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var { product_id, rating, title, review, order_id } = req.body;

    // Purchase verification: must be in a delivered order containing this product
    var verifiedOrder = null;
    if (MODE === 'local') {
      verifiedOrder = findDeliveredOrderLocal(req.user.id, product_id, order_id);
    } else {
      var sbCheck = req.supabase || supabase;
      verifiedOrder = await findDeliveredOrderSupabase(sbCheck, req.user.id, product_id, order_id);
    }
    if (!verifiedOrder) {
      return res.status(403).json({ error: 'You can only review products from delivered orders.' });
    }

    var result = await submitReview(req.user, { product_id: product_id, rating: rating, title: title, review: review, order_id: order_id, verified_order: verifiedOrder });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.review);
  } catch (e) { next(e); }
});

// DELETE /api/reviews/:id — owner only
router.delete('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    var id = req.params.id;
    var deleted = null;

    if (MODE === 'local') {
      var idx = -1;
      for (var i = 0; i < (store.raw.reviews || []).length; i++) {
        if (store.raw.reviews[i].id === Number(id) && store.raw.reviews[i].user_id === req.user.id) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return res.status(404).json({ error: 'Review not found' });
      deleted = store.raw.reviews[idx];
      store.raw.reviews.splice(idx, 1);
      store.persist();
    } else {
      var sb = getServiceClient() || req.supabase || supabase;
      var { data: got } = await sb.from('reviews').select('product_id, user_id').eq('id', id).eq('user_id', req.user.id).maybeSingle();
      if (!got) return res.status(404).json({ error: 'Review not found' });
      deleted = got;
      var { error } = await sb.from('reviews').delete().eq('id', id).eq('user_id', req.user.id);
      if (error) throw error;
    }

    // Remove the synced rating so product rating stats stay accurate
    if (deleted) {
      try {
        if (MODE === 'local') {
          var ratings = store.raw.ratings || [];
          var ridx = -1;
          for (var j = 0; j < ratings.length; j++) {
            if (ratings[j].target_type === 'product' && String(ratings[j].target_id) === String(deleted.product_id) && ratings[j].user_id === req.user.id) {
              ridx = j;
              break;
            }
          }
          if (ridx !== -1) {
            ratings.splice(ridx, 1);
            store.persist();
          }
          recalcProductRatingLocal(deleted.product_id);
        } else {
          var sb2 = getServiceClient() || req.supabase || supabase;
          await sb2.from('ratings').delete().eq('target_type', 'product').eq('target_id', deleted.product_id).eq('user_id', req.user.id);
          await supabaseRecalcProduct(deleted.product_id);
        }
      } catch (e2) {
        console.warn('[reviews] rating cleanup failed:', e2.message);
      }
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.submitReview = submitReview;
