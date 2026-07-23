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

module.exports = router;
