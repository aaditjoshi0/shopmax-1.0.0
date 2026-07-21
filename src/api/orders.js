var express = require('express');
var router = express.Router();
var { supabase, MODE } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');

function localFindCart(owner) {
  return store.raw.carts.find(function (c) { return c.owner === owner; }) || { owner: owner, items: [] };
}

// ── POST /api/orders ───────────────────────────────────────────────────────

router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var shipping = req.body.shipping || {};
    var sb = req.supabase || supabase;

    if (MODE === 'local') {
      var owner = 'user:' + req.user.id;
      var cart = localFindCart(owner);
      if (!cart.items || cart.items.length === 0) {
        return res.status(400).json({ error: 'Your cart is empty.' });
      }
      var required = ['fname', 'address', 'state_country', 'postal_zip', 'email_address', 'phone'];
      for (var f = 0; f < required.length; f++) {
        if (!shipping[required[f]] || !String(shipping[required[f]]).trim()) {
          return res.status(400).json({ error: 'Missing shipping field: ' + required[f] });
        }
      }
      var subtotal = cart.items.reduce(function (s, i) { return s + Number(i.price) * Number(i.quantity); }, 0);

      var discount = 0;
      var couponCode = (req.body.coupon_code || '').toString().trim().toUpperCase();
      if (couponCode) {
        var coupon = (store.raw.coupons || []).find(function (c) { return c.code === couponCode && c.active; });
        if (!coupon) return res.status(400).json({ error: 'Invalid coupon code.' });
        if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return res.status(400).json({ error: 'Coupon usage limit reached.' });
        if (subtotal < coupon.min_cart) return res.status(400).json({ error: 'Minimum cart value of \u20B9' + coupon.min_cart + ' required.' });
        if (coupon.type === 'percent') discount = Math.round((subtotal * coupon.value) / 100);
        else if (coupon.type === 'fixed') discount = Math.min(coupon.value, subtotal);
        coupon.used_count = (coupon.used_count || 0) + 1;
      }

      var deliveryCharge = 0;
      if (subtotal < 500) deliveryCharge = 50;
      else if (subtotal < 1000) deliveryCharge = 30;

      var total = Math.max(0, subtotal - discount + deliveryCharge);
      var order = {
        id: store.nextId('order'),
        user_id: req.user.id,
        items: cart.items.map(function (i) { return { ...i }; }),
        shipping: shipping,
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        delivery_charge: Number(deliveryCharge.toFixed(2)),
        coupon_code: couponCode || null,
        total: Number(total.toFixed(2)),
        status: 'placed',
        created_at: new Date().toISOString()
      };
      store.raw.orders.push(order);
      cart.items.forEach(function (i) {
        var vid = i.variant_id || (i.meta && i.meta.variant_id);
        if (vid) {
          var v = store.raw.variants.find(function (x) { return x.id === vid; });
          if (v) v.stock = Math.max(0, v.stock - Number(i.quantity));
        } else if (i.product_id) {
          var p = store.raw.products.find(function (x) { return x.id === i.product_id; });
          if (p) p.stock = Math.max(0, p.stock - Number(i.quantity));
        }
      });
      cart.items = [];
      store.persist();
      return res.json({ order: order });
    }

    // ── Supabase mode ────────────────────────────────────────────────────
    var requiredFields = ['fname', 'address', 'state_country', 'postal_zip', 'email_address', 'phone'];
    for (var rf = 0; rf < requiredFields.length; rf++) {
      if (!shipping[requiredFields[rf]] || !String(shipping[requiredFields[rf]]).trim()) {
        return res.status(400).json({ error: 'Missing shipping field: ' + requiredFields[rf] });
      }
    }

    var { data: cartData } = await sb
      .from('carts')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!cartData) return res.status(400).json({ error: 'Your cart is empty.' });

    var { data: items } = await sb
      .from('cart_items')
      .select('*')
      .eq('cart_id', cartData.id);

    if (!items || items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

    var errors = [];
    for (var ei = 0; ei < items.length; ei++) {
      var item = items[ei];

      var vid = item.variant_id || (item.meta && item.meta.variant_id);
      if (vid) {
        var { data: variant } = await sb
          .from('product_variants')
          .select('id, stock, status')
          .eq('id', vid)
          .single();

        if (!variant) {
          errors.push(item.name + ' variant is no longer available.');
          continue;
        }
        if (variant.status !== 'published') {
          errors.push(item.name + ' variant is no longer available for purchase.');
          continue;
        }
        if (variant.stock < item.quantity) {
          errors.push('Only ' + variant.stock + ' of "' + item.name + '" available (you requested ' + item.quantity + ').');
          continue;
        }

        var { error: vErr } = await sb
          .from('product_variants')
          .update({ stock: variant.stock - item.quantity })
          .eq('id', vid)
          .eq('stock', variant.stock);

        if (vErr) errors.push('Could not reserve stock for "' + item.name + '".');
        continue;
      }

      if (!item.product_id) continue;

      var { data: product } = await sb
        .from('products')
        .select('id, stock, status')
        .eq('id', item.product_id)
        .single();

      if (!product) {
        errors.push(item.name + ' is no longer available.');
        continue;
      }
      if (product.status !== 'published') {
        errors.push(item.name + ' is no longer available for purchase.');
        continue;
      }
      if (product.stock < item.quantity) {
        errors.push('Only ' + product.stock + ' of "' + item.name + '" available (you requested ' + item.quantity + ').');
        continue;
      }

      var { error: updateErr } = await sb
        .from('products')
        .update({ stock: product.stock - item.quantity })
        .eq('id', item.product_id)
        .eq('stock', product.stock);

      if (updateErr) {
        errors.push('Could not reserve stock for "' + item.name + '".');
      }
    }

    if (errors.length > 0) return res.status(400).json({ error: errors.join(' ') });

    var subtotal2 = items.reduce(function (s, i) { return s + Number(i.price) * Number(i.quantity); }, 0);

    // Coupon validation (public coupons table — anon client is fine)
    var discount2 = 0;
    var couponCode2 = (req.body.coupon_code || '').toString().trim().toUpperCase();
    if (couponCode2) {
      var { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', couponCode2)
        .maybeSingle();

      if (!coupon) return res.status(400).json({ error: 'Invalid coupon code.' });
      if (!coupon.active) return res.status(400).json({ error: 'This coupon is no longer active.' });
      if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) return res.status(400).json({ error: 'This coupon has reached its usage limit.' });
      if (subtotal2 < coupon.min_cart) return res.status(400).json({ error: 'Minimum cart value of \u20B9' + coupon.min_cart + ' required for this coupon.' });

      if (coupon.type === 'percent') discount2 = Math.round((subtotal2 * coupon.value) / 100);
      else if (coupon.type === 'fixed') discount2 = Math.min(coupon.value, subtotal2);

      await supabase.from('coupons').update({ used_count: coupon.used_count + 1 }).eq('code', couponCode2).catch(function () {});
    }

    var deliveryCharge2 = 0;
    if (subtotal2 < 500) deliveryCharge2 = 50;
    else if (subtotal2 < 1000) deliveryCharge2 = 30;

    var total2 = subtotal2 - discount2 + deliveryCharge2;
    if (total2 < 0) total2 = 0;

    // Build insert without coupon/delivery columns first (they may not exist yet)
    var orderInsert = {
      user_id: req.user.id,
      items: items.map(function (i) { return { ...i }; }),
      shipping: shipping,
      subtotal: Number(subtotal2.toFixed(2)),
      total: Number(total2.toFixed(2)),
      status: 'placed',
      created_at: new Date().toISOString()
    };
    // These columns are optional — added by migration if exec_sql is available
    if (discount2) orderInsert.discount = Number(discount2.toFixed(2));
    if (deliveryCharge2) orderInsert.delivery_charge = Number(deliveryCharge2.toFixed(2));
    if (couponCode2) orderInsert.coupon_code = couponCode2;

    var { data: order2, error: orderErr } = await sb
      .from('orders')
      .insert(orderInsert)
      .select()
      .single();

    // If the insert fails because optional columns don't exist, retry without them
    if (orderErr && (orderErr.message || '').toLowerCase().indexOf('column') >= 0) {
      delete orderInsert.discount;
      delete orderInsert.delivery_charge;
      delete orderInsert.coupon_code;
      orderInsert.total = Number(subtotal2.toFixed(2));
      var retry = await sb.from('orders').insert(orderInsert).select().single();
      if (retry.error) throw new Error('Failed to create order: ' + retry.error.message);
      order2 = retry.data;
    } else if (orderErr) {
      throw new Error('Failed to create order: ' + orderErr.message);
    }

    // Clear cart
    await sb.from('cart_items').delete().eq('cart_id', cartData.id);
    await sb.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cartData.id);

    res.json({ order: order2 });
  } catch (e) { next(e); }
});

// ── GET /api/orders ────────────────────────────────────────────────────────

router.get('/', getUser, requireUser, async (req, res, next) => {
  try {
    var sb = req.supabase || supabase;

    if (MODE === 'local') {
      var orders = store.raw.orders
        .filter(function (o) { return o.user_id === req.user.id; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      return res.json(orders);
    }

    var { data: orders2, error } = await sb
      .from('orders')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(orders2 || []);
  } catch (e) { next(e); }
});

// ── GET /api/orders/:id ────────────────────────────────────────────────────

router.get('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    var sb = req.supabase || supabase;

    if (MODE === 'local') {
      var order = store.raw.orders.find(function (o) { return o.id === Number(req.params.id); });
      if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      return res.json(order);
    }

    var query = sb.from('orders').select('*').eq('id', req.params.id);
    // If not admin, restrict to own orders
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    var { data: order2, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!order2) return res.status(404).json({ error: 'Order not found' });

    res.json(order2);
  } catch (e) { next(e); }
});

module.exports = router;
