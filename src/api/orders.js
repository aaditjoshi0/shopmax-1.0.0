// Orders API.
//  POST /api/orders            -> create order from current cart { shipping }
//  GET  /api/orders            -> list current user's orders
//  GET  /api/orders/:id        -> single order (owner only)

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser } = require('../middleware/auth');

// ── Local-mode helper ──────────────────────────────────────────────────────

function localFindCart(owner) {
  return store.raw.carts.find(c => c.owner === owner) || { owner, items: [] };
}

// ── POST /api/orders ───────────────────────────────────────────────────────

router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    const shipping = req.body.shipping || {};

    if (MODE === 'local') {
      const owner = 'user:' + req.user.id;
      const cart = localFindCart(owner);
      if (!cart.items || cart.items.length === 0) {
        return res.status(400).json({ error: 'Your cart is empty.' });
      }
      const required = ['fname', 'address', 'state_country', 'postal_zip', 'email_address', 'phone'];
      for (const f of required) {
        if (!shipping[f] || !String(shipping[f]).trim()) {
          return res.status(400).json({ error: 'Missing shipping field: ' + f });
        }
      }
      const subtotal = cart.items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
      const order = {
        id: store.nextId('order'),
        user_id: req.user.id,
        items: cart.items.map(i => ({ ...i })),
        shipping,
        subtotal: Number(subtotal.toFixed(2)),
        total: Number(subtotal.toFixed(2)),
        status: 'placed',
        created_at: new Date().toISOString()
      };
      store.raw.orders.push(order);
      cart.items.forEach(i => {
        if (i.product_id) {
          const p = store.raw.products.find(p => p.id === i.product_id);
          if (p) p.stock = Math.max(0, p.stock - Number(i.quantity));
        }
      });
      cart.items = [];
      store.persist();
      return res.json({ order });
    }

    // ── Supabase mode ────────────────────────────────────────────────────
    // Validate shipping fields
    const required = ['fname', 'address', 'state_country', 'postal_zip', 'email_address', 'phone'];
    for (const f of required) {
      if (!shipping[f] || !String(shipping[f]).trim()) {
        return res.status(400).json({ error: 'Missing shipping field: ' + f });
      }
    }

    // Get user's cart
    const { data: cart } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!cart) return res.status(400).json({ error: 'Your cart is empty.' });

    const { data: items } = await supabase
      .from('cart_items')
      .select('*')
      .eq('cart_id', cart.id);

    if (!items || items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

    // Validate stock and decrement atomically
    const errors = [];
    for (const item of items) {
      if (!item.product_id) continue;

      const { data: product } = await supabase
        .from('products')
        .select('id, stock, status')
        .eq('id', item.product_id)
        .single();

      if (!product) {
        errors.push(`${item.name} is no longer available.`);
        continue;
      }
      if (product.status !== 'published') {
        errors.push(`${item.name} is no longer available for purchase.`);
        continue;
      }
      if (product.stock < item.quantity) {
        errors.push(`Only ${product.stock} of "${item.name}" available (you requested ${item.quantity}).`);
        continue;
      }

      // Decrement stock
      const { error: updateErr } = await supabase
        .from('products')
        .update({ stock: product.stock - item.quantity })
        .eq('id', item.product_id)
        .eq('stock', product.stock); // Optimistic concurrency: only update if stock hasn't changed

      if (updateErr) {
        errors.push(`Could not reserve stock for "${item.name}".`);
      }
    }

    if (errors.length > 0) return res.status(400).json({ error: errors.join(' ') });

    // Create order snapshot
    const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
    const orderInsert = {
      user_id: req.user.id,
      items: items.map(i => ({ ...i })),
      shipping,
      subtotal: Number(subtotal.toFixed(2)),
      total: Number(subtotal.toFixed(2)),
      status: 'placed',
      created_at: new Date().toISOString()
    };

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert(orderInsert)
      .select()
      .single();

    if (orderErr) throw new Error('Failed to create order: ' + orderErr.message);

    // Clear cart
    await supabase.from('cart_items').delete().eq('cart_id', cart.id);
    await supabase.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cart.id);

    res.json({ order });
  } catch (e) { next(e); }
});

// ── GET /api/orders ────────────────────────────────────────────────────────

router.get('/', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const orders = store.raw.orders
        .filter(o => o.user_id === req.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json(orders);
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(orders || []);
  } catch (e) { next(e); }
});

// ── GET /api/orders/:id ────────────────────────────────────────────────────

router.get('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const order = store.raw.orders.find(o => o.id === Number(req.params.id));
      // Admins can view any order; regular users can only view their own
      if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      return res.json(order);
    }

    let query = supabase.from('orders').select('*').eq('id', req.params.id);
    // If not admin, restrict to own orders
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    const { data: order, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json(order);
  } catch (e) { next(e); }
});

module.exports = router;
