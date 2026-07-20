const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireAdmin } = require('../middleware/auth');

// GET /api/admin/dashboard — aggregate stats for the admin dashboard
router.get('/dashboard', getUser, requireAdmin, async (req, res, next) => {
  try {
    let totalUsers = 0;
    let totalProducts = 0;
    let totalOrders = 0;
    let totalRevenue = 0;
    let recentOrders = [];
    let productStatusCounts = { published: 0, draft: 0, hidden: 0, inactive: 0 };

    if (MODE === 'local') {
      totalUsers = store.raw.profiles.length;
      totalProducts = store.raw.products.length;
      (store.raw.products || []).forEach(p => {
        const s = p.status || 'published';
        if (productStatusCounts[s] !== undefined) productStatusCounts[s]++;
      });
      const orders = store.raw.orders || [];
      totalOrders = orders.length;
      totalRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
      recentOrders = orders
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10)
        .map(o => ({
          id: o.id,
          customer: o.shipping ? o.shipping.fname || 'N/A' : 'N/A',
          total: o.total,
          status: o.status,
          date: o.created_at
        }));
    } else {
      const [userRes, prodRes, prodStatusRes, countRes, allOrdersRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('status'),
        supabase.from('orders').select('id,total', { count: 'exact' }),
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(10)
      ]);
      totalUsers = userRes.count || 0;
      totalProducts = prodRes.count || 0;
      (prodStatusRes.data || []).forEach(p => {
        const s = p.status || 'published';
        if (productStatusCounts[s] !== undefined) productStatusCounts[s]++;
      });
      totalOrders = countRes.count || 0;
      totalRevenue = (countRes.data || []).reduce((s, o) => s + Number(o.total || 0), 0);
      recentOrders = (allOrdersRes.data || []).map(o => ({
        id: o.id,
        customer: o.shipping ? o.shipping.fname || 'N/A' : 'N/A',
        total: o.total,
        status: o.status,
        date: o.created_at
      }));
    }

    res.json({ totalUsers, totalProducts, totalOrders, totalRevenue, recentOrders, productStatusCounts });
  } catch (e) { next(e); }
});

// GET /api/admin/users — list all users
router.get('/users', getUser, requireAdmin, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const users = store.raw.profiles.map(p => ({
        id: p.id,
        email: p.email,
        name: p.full_name,
        mobile: p.mobile,
        role: p.role || 'customer',
        created_at: p.created_at
      }));
      return res.json(users);
    }
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { next(e); }
});

// GET /api/admin/orders — list all orders (with customer info)
router.get('/orders', getUser, requireAdmin, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const orders = (store.raw.orders || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json(orders);
    }

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (e) { next(e); }
});

// GET /api/admin/settings — get admin settings
router.get('/settings', getUser, requireAdmin, (req, res) => {
  res.json({
    site_name: 'ShopMax',
    admin_email: req.user.email,
    admin_name: req.user.name
  });
});

module.exports = router;
