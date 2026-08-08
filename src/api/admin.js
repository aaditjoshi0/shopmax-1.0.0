var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireAdmin } = require('../middleware/auth');

// GET /api/admin/dashboard
router.get('/dashboard', getUser, requireAdmin, async (req, res, next) => {
  try {
    var totalUsers = 0;
    var totalProducts = 0;
    var totalOrders = 0;
    var totalRevenue = 0;
    var recentOrders = [];
    var productStatusCounts = { published: 0, draft: 0, hidden: 0, inactive: 0 };
    var inventoryStats = { totalStock: 0, lowStockCount: 0, outOfStockCount: 0, totalVariants: 0 };

    if (MODE === 'local') {
      totalUsers = store.raw.profiles.length;
      totalProducts = store.raw.products.length;
      (store.raw.products || []).forEach(function (p) {
        var s = p.status || 'published';
        if (productStatusCounts[s] !== undefined) productStatusCounts[s]++;
      });
      var orders = store.raw.orders || [];
      totalOrders = orders.length;
      totalRevenue = orders.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
      recentOrders = orders
        .slice()
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
        .slice(0, 10)
        .map(function (o) {
          return {
            id: o.id,
            customer: o.shipping ? o.shipping.fname || 'N/A' : 'N/A',
            total: o.total,
            status: o.status,
            date: o.created_at
          };
        });
      // Inventory stats from variants
      var variants = store.raw.variants || [];
      inventoryStats.totalVariants = variants.length;
      inventoryStats.totalStock = variants.reduce(function (s, v) { return s + (v.stock || 0); }, 0);
      inventoryStats.lowStockCount = variants.filter(function (v) { return v.stock > 0 && v.stock <= 5; }).length;
      inventoryStats.outOfStockCount = variants.filter(function (v) { return v.stock === 0; }).length;
      // Also count product-level stock for products without variants
      var allProds = store.raw.products || [];
      var varProdIds = {};
      variants.forEach(function (v) { varProdIds[v.product_id] = true; });
      allProds.forEach(function (p) {
        if (!varProdIds[p.id]) {
          inventoryStats.totalVariants++;
          inventoryStats.totalStock += p.stock || 0;
          if (p.stock > 0 && p.stock <= 5) inventoryStats.lowStockCount++;
          if (p.stock === 0) inventoryStats.outOfStockCount++;
        }
      });
    } else {
      var sb = getServiceClient() || req.supabase || supabase;
      var [userRes, prodRes, prodStatusRes, countRes, allOrdersRes, variantRes] = await Promise.all([
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('products').select('id', { count: 'exact', head: true }),
        sb.from('products').select('id,status,stock'),
        sb.from('orders').select('id,total', { count: 'exact' }),
        sb.from('orders').select('*').order('created_at', { ascending: false }).limit(10),
        sb.from('product_variants').select('product_id,stock')
      ]);
      totalUsers = userRes.count || 0;
      totalProducts = prodRes.count || 0;
      (prodStatusRes.data || []).forEach(function (p) {
        var s = p.status || 'published';
        if (productStatusCounts[s] !== undefined) productStatusCounts[s]++;
      });
      totalOrders = countRes.count || 0;
      totalRevenue = (countRes.data || []).reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
      recentOrders = (allOrdersRes.data || []).map(function (o) {
        return {
          id: o.id,
          customer: o.shipping ? o.shipping.fname || 'N/A' : 'N/A',
          total: o.total,
          status: o.status,
          date: o.created_at
        };
      });
      var vData = variantRes.data || [];
      inventoryStats.totalVariants = vData.length;
      inventoryStats.totalStock = vData.reduce(function (s, v) { return s + (v.stock || 0); }, 0);
      inventoryStats.lowStockCount = vData.filter(function (v) { return v.stock > 0 && v.stock <= 5; }).length;
      inventoryStats.outOfStockCount = vData.filter(function (v) { return v.stock === 0; }).length;
      // Also count product-level stock for products without variants
      var varProdIds = {};
      vData.forEach(function (v) { if (v.product_id) varProdIds[v.product_id] = true; });
      (prodStatusRes.data || []).forEach(function (p) {
        if (!varProdIds[p.id]) {
          inventoryStats.totalVariants++;
          inventoryStats.totalStock += p.stock || 0;
          if (p.stock > 0 && p.stock <= 5) inventoryStats.lowStockCount++;
          if (p.stock === 0) inventoryStats.outOfStockCount++;
        }
      });
    }

    res.json({ totalUsers: totalUsers, totalProducts: totalProducts, totalOrders: totalOrders, totalRevenue: totalRevenue, recentOrders: recentOrders, productStatusCounts: productStatusCounts, inventoryStats: inventoryStats });
  } catch (e) { next(e); }
});

// GET /api/admin/users
router.get('/users', getUser, requireAdmin, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var users = store.raw.profiles.map(function (p) {
        return {
          id: p.id,
          email: p.email,
          name: p.full_name,
          mobile: p.mobile,
          role: p.role || 'customer',
          created_at: p.created_at
        };
      });
      return res.json(users);
    }
    var sb = req.supabase || supabase;
    var { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

// GET /api/admin/orders
router.get('/orders', getUser, requireAdmin, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var orders = (store.raw.orders || []).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      return res.json(orders);
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data, error } = await sb
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

// GET /api/admin/settings
router.get('/settings', getUser, requireAdmin, function (req, res) {
  res.json({
    site_name: 'ShopMax',
    admin_email: req.user.email,
    admin_name: req.user.name
  });
});

// GET /api/admin/ratings — rating stats for admin panel
router.get('/ratings', getUser, requireAdmin, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var products = store.raw.products || [];
      var withRatings = products.filter(function (p) { return (p.rating || 0) > 0; }).sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      var highest = withRatings.slice(0, 5).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; });
      var lowest = withRatings.slice().sort(function (a, b) { return (a.rating || 0) - (b.rating || 0); }).slice(0, 5).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; });
      var mostRated = products.slice().sort(function (a, b) { return (b.rating_count || 0) - (a.rating_count || 0); }).slice(0, 5).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; });
      var totalRatings = (store.raw.ratings || []).length;
      var totalRated = products.filter(function (p) { return (p.rating_count || 0) > 0; }).length;
      var allRatings2 = (store.raw.ratings || []).filter(function (r) { return r.target_type === 'product'; });
      var overallAvg2 = 0;
      if (allRatings2.length) overallAvg2 = Math.round(allRatings2.reduce(function (s, r) { return s + r.rating; }, 0) / allRatings2.length * 10) / 10;
      return res.json({ highestRated: highest, lowestRated: lowest, mostRated: mostRated, totalRatings: totalRatings, totalRatedProducts: totalRated, overallAverage: overallAvg2 });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data: pData } = await sb.from('products').select('id,name,rating,rating_count').order('rating', { ascending: false }).limit(5);
    var { data: pDataLow } = await sb.from('products').select('id,name,rating,rating_count').order('rating', { ascending: true }).limit(5);
    var { data: pDataMost } = await sb.from('products').select('id,name,rating,rating_count').order('rating_count', { ascending: false }).limit(5);
    var { data: rData } = await sb.from('ratings').select('rating', { count: 'exact' });
    var rAll = rData || [];
    var rCount = rAll.length;
    var oAvg = 0;
    if (rCount) oAvg = Math.round(rAll.reduce(function (s, r) { return s + r.rating; }, 0) / rCount * 10) / 10;
    res.json({
      highestRated: (pData || []).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; }),
      lowestRated: (pDataLow || []).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; }),
      mostRated: (pDataMost || []).map(function (p) { return { id: p.id, name: p.name, rating: p.rating || 0, count: p.rating_count || 0 }; }),
      totalRatings: rCount,
      totalRatedProducts: (pData || []).filter(function (p) { return (p.rating_count || 0) > 0; }).length,
      overallAverage: oAvg
    });
  } catch (e) { next(e); }
});

// GET /api/admin/reviews?product_id=&rating=&search= — review moderation
router.get('/reviews', getUser, requireAdmin, async (req, res, next) => {
  try {
    var productId = req.query.product_id;
    var rating = req.query.rating;
    var search = (req.query.search || '').toString().trim().toLowerCase();

    if (MODE === 'local') {
      var products = store.raw.products || [];
      var all = (store.raw.reviews || []).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var local = all.filter(function (r) {
        if (productId && String(r.product_id) !== String(productId)) return false;
        if (rating && String(r.rating) !== String(rating)) return false;
        if (search) {
          var p = products.find(function (x) { return String(x.id) === String(r.product_id); });
          var hay = ((p && p.name) || '') + ' ' + (r.title || '') + ' ' + (r.review || '') + ' ' + (r.user_name || '');
          if (hay.toLowerCase().indexOf(search) === -1) return false;
        }
        return true;
      }).map(function (r) {
        var p = products.find(function (x) { return String(x.id) === String(r.product_id); });
        return { id: r.id, product_id: r.product_id, product_name: p ? p.name : 'Product #' + r.product_id, user_id: r.user_id, user_name: r.user_name || 'Anonymous', rating: r.rating, title: r.title || '', review: r.review || '', verified_purchase: !!r.verified_purchase, created_at: r.created_at };
      });
      return res.json(local);
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var q = sb.from('reviews').select('*, products(id,name)').order('created_at', { ascending: false });
    if (productId) q = q.eq('product_id', productId);
    if (rating) q = q.eq('rating', rating);
    var { data, error } = await q;
    var rowsData = data || [];
    if (error) {
      if (error.code !== 'PGRST200') throw error;
      // No FK relationship to products — load reviews plainly and map product names in JS
      var q2 = sb.from('reviews').select('*').order('created_at', { ascending: false });
      if (productId) q2 = q2.eq('product_id', productId);
      if (rating) q2 = q2.eq('rating', rating);
      var { data: data2, error: error2 } = await q2;
      if (error2) throw error2;
      rowsData = data2 || [];
      var names = {};
      var pids = [];
      rowsData.forEach(function (r) {
        if (r.product_id !== null && pids.indexOf(String(r.product_id)) === -1) pids.push(String(r.product_id));
      });
      for (var b = 0; b < pids.length; b += 50) {
        var chunk = pids.slice(b, b + 50).map(Number);
        var { data: plist } = await sb.from('products').select('id,name').in('id', chunk);
        (plist || []).forEach(function (p) { names[String(p.id)] = p.name; });
      }
      rowsData = rowsData.map(function (r) {
        return Object.assign({}, r, { products: { id: r.product_id, name: names[String(r.product_id)] || null } });
      });
    }
    var rows = rowsData.filter(function (r) {
      if (!search) return true;
      var hay = ((r.products && r.products.name) || '') + ' ' + (r.title || '') + ' ' + (r.review || '') + ' ' + (r.user_name || '');
      return hay.toLowerCase().indexOf(search) !== -1;
    }).map(function (r) {
      return { id: r.id, product_id: r.product_id, product_name: r.products ? r.products.name : 'Product #' + r.product_id, user_id: r.user_id, user_name: r.user_name || 'Anonymous', rating: r.rating, title: r.title || '', review: r.review || '', verified_purchase: !!r.verified_purchase, created_at: r.created_at };
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// DELETE /api/admin/reviews/:id — admin moderation (also cleans up synced rating)
router.delete('/reviews/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    var id = req.params.id;

    if (MODE === 'local') {
      var idx = -1;
      for (var i = 0; i < (store.raw.reviews || []).length; i++) {
        if (store.raw.reviews[i].id === Number(id)) { idx = i; break; }
      }
      if (idx === -1) return res.status(404).json({ error: 'Review not found' });
      var del = store.raw.reviews[idx];
      store.raw.reviews.splice(idx, 1);
      var ratings = store.raw.ratings || [];
      for (var j = ratings.length - 1; j >= 0; j--) {
        if (ratings[j].target_type === 'product' && String(ratings[j].target_id) === String(del.product_id) && ratings[j].user_id === del.user_id) {
          ratings.splice(j, 1);
        }
      }
      var prodRatings = (store.raw.ratings || []).filter(function (r) { return r.target_type === 'product' && String(r.target_id) === String(del.product_id); });
      var product = store.raw.products.find(function (p) { return String(p.id) === String(del.product_id); });
      if (product) {
        product.rating = prodRatings.length ? Math.round(prodRatings.reduce(function (s, r) { return s + r.rating; }, 0) / prodRatings.length * 10) / 10 : 0;
        product.rating_count = prodRatings.length;
      }
      store.persist();
      return res.json({ ok: true });
    }

    var sb = getServiceClient() || req.supabase || supabase;
    var { data: got } = await sb.from('reviews').select('product_id, user_id').eq('id', id).maybeSingle();
    if (!got) return res.status(404).json({ error: 'Review not found' });
    var { error } = await sb.from('reviews').delete().eq('id', id);
    if (error) throw error;
    await sb.from('ratings').delete().eq('target_type', 'product').eq('target_id', got.product_id).eq('user_id', got.user_id);
    var { data: rAll } = await sb.from('ratings').select('rating').eq('target_type', 'product').eq('target_id', got.product_id);
    var rr = rAll || [];
    var count = rr.length;
    var avg = 0;
    if (count) avg = Math.round(rr.reduce(function (s, x) { return s + x.rating; }, 0) / count * 10) / 10;
    await sb.from('products').update({ rating: count ? avg : 0, rating_count: count, updated_at: new Date().toISOString() }).eq('id', got.product_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
