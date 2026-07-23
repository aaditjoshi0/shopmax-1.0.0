var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');

function hasPurchasedLocal(userId, targetType, targetId) {
  var orders = store.raw.orders || [];

  if (targetType === 'listing') {
    var listing = store.raw.listings.find(function (l) { return String(l.id) === String(targetId); });
    if (!listing || listing.status !== 'active') return false;
    var designId = listing.design_id;
    // Must have been ordered by at least one customer
    var hasOrder = false;
    for (var oi = 0; oi < orders.length; oi++) {
      var oItems = orders[oi].items || [];
      for (var oj = 0; oj < oItems.length; oj++) {
        if (oItems[oj].meta && String(oItems[oj].meta.design_id) === String(designId)) {
          hasOrder = true;
          break;
        }
      }
      if (hasOrder) break;
    }
    if (!hasOrder) return false;
    // Now check if THIS user has purchased it
    for (var oi2 = 0; oi2 < orders.length; oi2++) {
      if (orders[oi2].user_id !== userId) continue;
      var oItems2 = orders[oi2].items || [];
      for (var oj2 = 0; oj2 < oItems2.length; oj2++) {
        if (oItems2[oj2].meta && String(oItems2[oj2].meta.design_id) === String(designId)) return true;
      }
    }
    return false;
  }

  // Product check
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].user_id !== userId) continue;
    var items = orders[i].items || [];
    for (var j = 0; j < items.length; j++) {
      if (String(items[j].product_id) === String(targetId)) return true;
    }
  }
  return false;
}

async function hasPurchasedSupabase(sb, userId, targetType, targetId) {
  var { data } = await sb.from('orders').select('items').eq('user_id', userId);
  if (!data) return false;
  for (var i = 0; i < data.length; i++) {
    var items = data[i].items || [];
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (targetType === 'product' && String(item.product_id) === String(targetId)) return true;
    }
  }
  return false;
}

function recalcProductRating(productId) {
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

function recalcListingRating(listingId) {
  var ratings = (store.raw.ratings || []).filter(function (r) {
    return r.target_type === 'listing' && String(r.target_id) === String(listingId);
  });
  var count = ratings.length;
  var avg = 0;
  if (count) {
    avg = ratings.reduce(function (s, r) { return s + r.rating; }, 0) / count;
    avg = Math.round(avg * 10) / 10;
  }
  var listing = store.raw.listings.find(function (l) { return String(l.id) === String(listingId); });
  if (listing) {
    listing.rating = count ? avg : (listing.rating || 0);
    listing.rating_count = count;
    store.persist();
  }
}

async function supabaseRecalc(targetType, targetId) {
  var sb = getServiceClient() || supabase;
  var { data } = await sb.from('ratings').select('rating').eq('target_type', targetType).eq('target_id', targetId);
  var r = data || [];
  var count = r.length;
  var avg = 0;
  if (count) {
    avg = r.reduce(function (s, x) { return s + x.rating; }, 0) / count;
    avg = Math.round(avg * 10) / 10;
  }
  if (targetType === 'product') {
    await sb.from('products').update({
      rating: count ? avg : 0,
      rating_count: count,
      updated_at: new Date().toISOString()
    }).eq('id', targetId);
  }
  return { average: avg, count: count };
}

// GET /api/ratings/:targetType/:targetId — public
router.get('/:targetType/:targetId', getUser, async (req, res, next) => {
  try {
    var targetType = req.params.targetType;
    var targetId = Number(req.params.targetId);
    if (!['product', 'listing'].includes(targetType)) {
      return res.status(400).json({ error: 'Invalid target type' });
    }

    if (MODE === 'local') {
      var ratings = (store.raw.ratings || []).filter(function (r) {
        return r.target_type === targetType && String(r.target_id) === String(targetId);
      });
      var count = ratings.length;
      var avg = 0;
      if (count) {
        avg = ratings.reduce(function (s, r) { return s + r.rating; }, 0) / count;
        avg = Math.round(avg * 10) / 10;
      }
      var result = { average: avg, count: count, userRating: null };
      if (req.user) {
        var mine = ratings.find(function (r) { return r.user_id === req.user.id; });
        if (mine) result.userRating = mine.rating;
      }
      return res.json(result);
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data, error } = await sb.from('ratings').select('rating, user_id').eq('target_type', targetType).eq('target_id', targetId);
    if (error) throw error;
    var r = data || [];
    var count2 = r.length;
    var avg2 = 0;
    if (count2) {
      avg2 = r.reduce(function (s, x) { return s + x.rating; }, 0) / count2;
      avg2 = Math.round(avg2 * 10) / 10;
    }
    var result2 = { average: avg2, count: count2, userRating: null };
    if (req.user) {
      var mine2 = r.find(function (x) { return x.user_id === req.user.id; });
      if (mine2) result2.userRating = mine2.rating;
    }
    res.json(result2);
  } catch (e) { next(e); }
});

// POST /api/ratings — auth required (upsert, purchase verification)
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var { target_type, target_id, rating } = req.body;
    if (!target_type || !target_id) return res.status(400).json({ error: 'target_type and target_id are required' });
    if (!['product', 'listing'].includes(target_type)) {
      return res.status(400).json({ error: 'target_type must be "product" or "listing"' });
    }
    var nRating = Number(rating);
    if (!nRating || nRating < 1 || nRating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    var nTargetId = Number(target_id);
    if (!nTargetId) return res.status(400).json({ error: 'Invalid target_id' });

    // Purchase verification
    if (MODE === 'local') {
      if (!hasPurchasedLocal(req.user.id, target_type, nTargetId)) {
        return res.status(403).json({ error: 'You can only rate products you have purchased.' });
      }
    } else {
      var sb2 = req.supabase || supabase;
      var purchased = await hasPurchasedSupabase(sb2, req.user.id, target_type, nTargetId);
      if (!purchased) {
        return res.status(403).json({ error: 'You can only rate products you have purchased.' });
      }
    }

    if (MODE === 'local') {
      var existing = (store.raw.ratings || []).find(function (r) {
        return r.target_type === target_type && String(r.target_id) === String(nTargetId) && r.user_id === req.user.id;
      });
      if (existing) {
        existing.rating = nRating;
        existing.updated_at = new Date().toISOString();
        store.persist();
      } else {
        var ratingObj = {
          id: (store.raw.ratings.length || 0) + 1,
          target_type: target_type,
          target_id: nTargetId,
          user_id: req.user.id,
          rating: nRating,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        store.raw.ratings.push(ratingObj);
        store.persist();
      }
      if (target_type === 'product') recalcProductRating(nTargetId);
      else if (target_type === 'listing') recalcListingRating(nTargetId);

      var ratings = (store.raw.ratings || []).filter(function (r) {
        return r.target_type === target_type && String(r.target_id) === String(nTargetId);
      });
      var count = ratings.length;
      var avg = count ? Math.round(ratings.reduce(function (s, r) { return s + r.rating; }, 0) / count * 10) / 10 : 0;
      return res.json({ average: avg, count: count, userRating: nRating });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data: existing2 } = await sb.from('ratings').select('id').eq('target_type', target_type).eq('target_id', nTargetId).eq('user_id', req.user.id).maybeSingle();

    if (existing2) {
      await sb.from('ratings').update({ rating: nRating, updated_at: new Date().toISOString() }).eq('id', existing2.id);
    } else {
      await sb.from('ratings').insert({ target_type: target_type, target_id: nTargetId, user_id: req.user.id, rating: nRating });
    }

    var result = await supabaseRecalc(target_type, nTargetId);
    result.userRating = nRating;
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
