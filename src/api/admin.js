var express = require('express');
var router = express.Router();
var { supabase, MODE } = require('../../config/supabase');
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
    } else {
      var sb = req.supabase || supabase;
      var [userRes, prodRes, prodStatusRes, countRes, allOrdersRes] = await Promise.all([
        sb.from('profiles').select('id', { count: 'exact', head: true }),
        sb.from('products').select('id', { count: 'exact', head: true }),
        sb.from('products').select('status'),
        sb.from('orders').select('id,total', { count: 'exact' }),
        sb.from('orders').select('*').order('created_at', { ascending: false }).limit(10)
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
    }

    res.json({ totalUsers: totalUsers, totalProducts: totalProducts, totalOrders: totalOrders, totalRevenue: totalRevenue, recentOrders: recentOrders, productStatusCounts: productStatusCounts });
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

    var sb = req.supabase || supabase;
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

module.exports = router;
