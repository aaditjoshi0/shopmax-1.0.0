var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');
var { submitReview } = require('./reviews');

function localFindCart(owner) {
  return store.raw.carts.find(function (c) { return c.owner === owner; }) || { owner: owner, items: [] };
}

// ── Helper: enrich order with product images for local mode ──────────────────
function enrichLocalOrder(order) {
  if (!order || !order.items) return order;
  var items = order.items.map(function (item) {
    if (item.image_url) return item;
    if (item.product_id) {
      var p = store.raw.products.find(function (x) { return x.id === item.product_id; });
      if (p) item.image_url = p.image_url;
    }
    return item;
  });
  return Object.assign({}, order, { items: items });
}

// ── Helper: default tracking statuses with proper transitions ────────────────
var VALID_STATUS_TRANSITIONS = {
  placed:       ['confirmed', 'cancelled'],
  confirmed:    ['packed', 'cancelled'],
  packed:       ['shipped', 'cancelled'],
  shipped:      ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered:    ['returned'],
  cancelled:    [],
  returned:     []
};

var STATUS_LABELS = {
  placed: 'Order Placed',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out For Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned'
};

var STATUS_TIMELINE_ORDER = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];

function calcEstimatedDelivery(created) {
  var d = new Date(created);
  d.setDate(d.getDate() + 3);
  return d.toISOString();
}

// ── POST /api/orders ───────────────────────────────────────────────────────

router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    var shipping = req.body.shipping || {};
    var payment_method = req.body.payment_method || 'cod';
    var payment_result = req.body.payment_result || {};
    var coupon_code = req.body.coupon_code || null;
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
      var freeDelivery = false;
      coupon_code = (coupon_code || '').toString().trim().toUpperCase();
      if (coupon_code) {
        var coupon = (store.raw.coupons || []).find(function (c) { return c.code === coupon_code; });
        if (!coupon) return res.status(400).json({ error: 'Invalid coupon code.' });
        if (!coupon.active) return res.status(400).json({ error: 'This coupon is no longer active.' });
        if (coupon.max_uses > 0 && (coupon.used_count || 0) >= coupon.max_uses) return res.status(400).json({ error: 'This coupon has reached its usage limit.' });
        if (subtotal < (coupon.min_cart || 0)) return res.status(400).json({ error: 'Minimum cart value of \u20B9' + coupon.min_cart + ' required for this coupon.' });
        if (coupon.start_date && new Date(coupon.start_date) > new Date()) return res.status(400).json({ error: 'This coupon is not yet active.' });
        if (coupon.end_date && new Date(coupon.end_date) < new Date()) return res.status(400).json({ error: 'This coupon has expired.' });
        if (coupon.first_order_only) {
          var priorOrders = (store.raw.orders || []).filter(function (o) { return o.user_id === req.user.id && o.status !== 'cancelled'; });
          if (priorOrders.length > 0) return res.status(400).json({ error: 'This coupon is for first-time orders only.' });
        }
        if (coupon.per_user_limit > 0) {
          var userUsage = (store.raw.coupon_usage || []).filter(function (u) { return u.coupon_code === coupon_code && u.user_id === req.user.id; });
          if (userUsage.length >= coupon.per_user_limit) return res.status(400).json({ error: 'You have reached the usage limit for this coupon.' });
        }
        if (coupon.type === 'percent') discount = Math.round((subtotal * coupon.value) / 100);
        else if (coupon.type === 'fixed') discount = Math.min(coupon.value, subtotal);
        if (coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);
        freeDelivery = !!coupon.free_delivery;
        coupon.used_count = (coupon.used_count || 0) + 1;
      }

      var hasFreeBenefit = cart.items.some(function (i) {
        if (!i.product_id) return false;
        var p = store.raw.products.find(function (x) { return x.id === i.product_id; });
        return p && p.benefits && p.benefits.indexOf('free_delivery') >= 0;
      });
      var deliveryCharge = 0;
      if (!freeDelivery && !hasFreeBenefit) {
        if (subtotal < 500) deliveryCharge = 50;
        else if (subtotal < 1000) deliveryCharge = 30;
      }

      if (payment_method !== 'cod' && !payment_result.success) {
        return res.status(400).json({ error: 'Payment verification failed. Please complete the payment before placing an order.' });
      }

      var total = Math.max(0, subtotal - discount + deliveryCharge);
      var now = new Date().toISOString();
      var order = {
        id: store.nextId('order'),
        user_id: req.user.id,
        items: cart.items.map(function (i) { return Object.assign({}, i); }),
        shipping: shipping,
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        delivery_charge: Number(deliveryCharge.toFixed(2)),
        coupon_code: coupon_code || null,
        payment_method: payment_method || 'cod',
        payment_status: (payment_method === 'cod') ? 'pending' : (payment_result.success ? 'paid' : 'pending'),
        payment_id: (payment_result.transaction_id || ''),
        payment_gateway: (payment_result.gateway || ''),
        payment_time: (payment_result.timestamp || now),
        upi_id: (payment_result.upi_id || ''),
        card_last4: (payment_result.last4 || ''),
        is_cod: (payment_method === 'cod'),
        wallet_name: (payment_result.wallet_name || ''),
        total: Number(total.toFixed(2)),
        status: 'placed',
        estimated_delivery: calcEstimatedDelivery(now),
        created_at: now
      };
      store.raw.orders.push(order);
      if (coupon_code && discount > 0) {
        if (!store.raw.coupon_usage) store.raw.coupon_usage = [];
        store.raw.coupon_usage.push({
          id: store.nextId('coupon_usage'),
          coupon_code: coupon_code,
          user_id: req.user.id,
          order_id: order.id,
          discount_amount: discount,
          created_at: now
        });
      }
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
      return res.json({ order: enrichLocalOrder(order) });
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

    var pids2 = items.filter(function (i) { return i.product_id; }).map(function (i) { return i.product_id; });
    if (pids2.length) {
      var { data: prods } = await sb.from('products').select('id, benefits').in('id', pids2);
      if (prods) {
        var bmap = {};
        prods.forEach(function (p) { bmap[p.id] = p.benefits || []; });
        items.forEach(function (i) { if (i.product_id && bmap[i.product_id]) i.benefits = bmap[i.product_id]; });
      }
    }

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
        if (!variant) { errors.push(item.name + ' variant is no longer available.'); continue; }
        if (variant.status !== 'published') { errors.push(item.name + ' variant is no longer available for purchase.'); continue; }
        if (variant.stock < item.quantity) { errors.push('Only ' + variant.stock + ' of "' + item.name + '" available.'); continue; }
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
      if (!product) { errors.push(item.name + ' is no longer available.'); continue; }
      if (product.status !== 'published') { errors.push(item.name + ' is no longer available for purchase.'); continue; }
      if (product.stock < item.quantity) { errors.push('Only ' + product.stock + ' of "' + item.name + '" available.'); continue; }
      var { error: updateErr } = await sb
        .from('products')
        .update({ stock: product.stock - item.quantity })
        .eq('id', item.product_id)
        .eq('stock', product.stock);
      if (updateErr) errors.push('Could not reserve stock for "' + item.name + '".');
    }

    if (errors.length > 0) return res.status(400).json({ error: errors.join(' ') });

    var subtotal2 = items.reduce(function (s, i) { return s + Number(i.price) * Number(i.quantity); }, 0);

    var discount2 = 0;
    var freeDelivery2 = false;
    coupon_code = (coupon_code || '').toString().trim().toUpperCase();
    if (coupon_code) {
      var coupon = (store.raw.coupons || []).find(function (c) { return c.code === coupon_code; });
      if (!coupon) return res.status(400).json({ error: 'Invalid coupon code.' });
      if (!coupon.active) return res.status(400).json({ error: 'This coupon is no longer active.' });
      if (coupon.max_uses > 0 && (coupon.used_count || 0) >= coupon.max_uses) return res.status(400).json({ error: 'This coupon has reached its usage limit.' });
      if (subtotal2 < (coupon.min_cart || 0)) return res.status(400).json({ error: 'Minimum cart value of \u20B9' + coupon.min_cart + ' required for this coupon.' });
      if (coupon.start_date && new Date(coupon.start_date) > new Date()) return res.status(400).json({ error: 'This coupon is not yet active.' });
      if (coupon.end_date && new Date(coupon.end_date) < new Date()) return res.status(400).json({ error: 'This coupon has expired.' });
      if (coupon.first_order_only) {
        var priorOrders = (store.raw.orders || []).filter(function (o) { return o.user_id === req.user.id && o.status !== 'cancelled'; });
        if (priorOrders.length > 0) return res.status(400).json({ error: 'This coupon is for first-time orders only.' });
      }
      if (coupon.per_user_limit > 0) {
        var userUsage = (store.raw.coupon_usage || []).filter(function (u) { return u.coupon_code === coupon_code && u.user_id === req.user.id; });
        if (userUsage.length >= coupon.per_user_limit) return res.status(400).json({ error: 'You have reached the usage limit for this coupon.' });
      }
      if (coupon.type === 'percent') discount2 = Math.round((subtotal2 * coupon.value) / 100);
      else if (coupon.type === 'fixed') discount2 = Math.min(coupon.value, subtotal2);
      if (coupon.max_discount > 0) discount2 = Math.min(discount2, coupon.max_discount);
      freeDelivery2 = !!coupon.free_delivery;
      coupon.used_count = (coupon.used_count || 0) + 1;
      store.persist();
    }

    var hasFreeBenefit2 = items.some(function (i) {
      return i.benefits && i.benefits.indexOf('free_delivery') >= 0;
    });
    var deliveryCharge2 = 0;
    if (!freeDelivery2 && !hasFreeBenefit2) {
      if (subtotal2 < 500) deliveryCharge2 = 50;
      else if (subtotal2 < 1000) deliveryCharge2 = 30;
    }

    if (payment_method !== 'cod' && (!payment_result || !payment_result.success)) {
      return res.status(400).json({ error: 'Payment verification failed. Please complete the payment.' });
    }

    var total2 = subtotal2 - discount2 + deliveryCharge2;
    if (total2 < 0) total2 = 0;

    var orderInsert = {
      user_id: req.user.id,
      items: items.map(function (i) { return Object.assign({}, i); }),
      shipping: shipping,
      subtotal: Number(subtotal2.toFixed(2)),
      total: Number(total2.toFixed(2)),
      status: 'placed',
      payment_method: payment_method || 'cod',
      payment_status: (payment_method === 'cod') ? 'pending' : (payment_result.success ? 'paid' : 'pending'),
      payment_id: (payment_result.transaction_id || ''),
      payment_gateway: (payment_result.gateway || ''),
      payment_time: (payment_result.timestamp || new Date().toISOString()),
      is_cod: (payment_method === 'cod'),
      upi_id: (payment_result.upi_id || ''),
      card_last4: (payment_result.last4 || ''),
      wallet_name: (payment_result.wallet_name || ''),
      estimated_delivery: calcEstimatedDelivery(new Date().toISOString()),
      created_at: new Date().toISOString()
    };
    if (discount2) orderInsert.discount = Number(discount2.toFixed(2));
    if (deliveryCharge2) orderInsert.delivery_charge = Number(deliveryCharge2.toFixed(2));
    if (coupon_code) orderInsert.coupon_code = coupon_code;

    var { data: order2, error: orderErr } = await sb
      .from('orders')
      .insert(orderInsert)
      .select()
      .single();

    if (orderErr && (orderErr.code === 'PGRST204' || (orderErr.message || '').toLowerCase().indexOf('column') >= 0)) {
      delete orderInsert.discount;
      delete orderInsert.delivery_charge;
      delete orderInsert.coupon_code;
      delete orderInsert.estimated_delivery;
      delete orderInsert.payment_method;
      delete orderInsert.payment_status;
      delete orderInsert.payment_id;
      delete orderInsert.payment_gateway;
      delete orderInsert.payment_time;
      delete orderInsert.upi_id;
      delete orderInsert.card_last4;
      delete orderInsert.is_cod;
      delete orderInsert.wallet_name;
      orderInsert.total = Number(subtotal2.toFixed(2));
      var retry = await sb.from('orders').insert(orderInsert).select().single();
      if (retry.error) throw new Error('Failed to create order: ' + retry.error.message);
      order2 = retry.data;
    } else if (orderErr) {
      throw new Error('Failed to create order: ' + orderErr.message);
    }

    if (coupon_code && discount2 > 0) {
      if (!store.raw.coupon_usage) store.raw.coupon_usage = [];
      store.raw.coupon_usage.push({
        id: store.nextId('coupon_usage'),
        coupon_code: coupon_code,
        user_id: req.user.id,
        order_id: order2.id,
        discount_amount: discount2,
        created_at: new Date().toISOString()
      });
      store.persist();
    }

    await sb.from('cart_items').delete().eq('cart_id', cartData.id);
    await sb.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cartData.id);

    res.json({ order: order2 });
  } catch (e) { next(e); }
});

// ── GET /api/orders ────────────────────────────────────────────────────────

router.get('/', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var orders = store.raw.orders
        .filter(function (o) { return o.user_id === req.user.id; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      return res.json(orders.map(enrichLocalOrder));
    }

    var sb = (req.user.role === 'admin' ? (getServiceClient() || req.supabase || supabase) : req.supabase || supabase);
    var query = sb.from('orders').select('*');
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    var { data: orders2, error } = await query
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(orders2 || []);
  } catch (e) { next(e); }
});

// ── GET /api/orders/:id ────────────────────────────────────────────────────

router.get('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var order = store.raw.orders.find(function (o) { return o.id === Number(req.params.id); });
      if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      return res.json(enrichLocalOrder(order));
    }

    // Supabase mode: admin must use service client to bypass RLS
    var sb = (req.user.role === 'admin' ? (getServiceClient() || req.supabase || supabase) : req.supabase || supabase);
    var query = sb.from('orders').select('*').eq('id', req.params.id);
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    var { data: order2, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!order2) return res.status(404).json({ error: 'Order not found' });

    res.json(order2);
  } catch (e) { next(e); }
});

// ── PATCH /api/orders/:id/status (customer cancel) ─────────────────────────

router.patch('/:id/status', getUser, requireUser, async (req, res, next) => {
  try {
    var orderId = Number(req.params.id);
    var { action } = req.body; // 'cancel' or status transition

    if (MODE === 'local') {
      var order = store.raw.orders.find(function (o) { return o.id === orderId; });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (action === 'cancel') {
        var canCancel = ['placed', 'confirmed', 'packed'].indexOf(order.status) >= 0;
        if (!canCancel) {
          return res.status(400).json({ error: 'Order cannot be cancelled at this stage. It has already been shipped.' });
        }
        order.status = 'cancelled';
        // Restore stock
        (order.items || []).forEach(function (item) {
          var vid = item.variant_id || (item.meta && item.meta.variant_id);
          if (vid) {
            var v = store.raw.variants.find(function (x) { return x.id === vid; });
            if (v) v.stock += Number(item.quantity);
          } else if (item.product_id) {
            var p = store.raw.products.find(function (x) { return x.id === item.product_id; });
            if (p) p.stock += Number(item.quantity);
          }
        });
        store.persist();
      } else if (action === 'return') {
        if (order.status !== 'delivered') {
          return res.status(400).json({ error: 'Return is only available for delivered orders.' });
        }
        if (!order.return_eligible) {
          return res.status(400).json({ error: 'Return window has expired.' });
        }
        order.status = 'returned';
        // Restore stock
        (order.items || []).forEach(function (item) {
          var vid = item.variant_id || (item.meta && item.meta.variant_id);
          if (vid) {
            var v = store.raw.variants.find(function (x) { return x.id === vid; });
            if (v) v.stock += Number(item.quantity);
          } else if (item.product_id) {
            var p = store.raw.products.find(function (x) { return x.id === item.product_id; });
            if (p) p.stock += Number(item.quantity);
          }
        });
        store.persist();
      } else if (req.user.role === 'admin') {
        // Admin status updates
        var validTargets = VALID_STATUS_TRANSITIONS[order.status];
        if (!validTargets || validTargets.indexOf(action) === -1) {
          return res.status(400).json({ error: 'Invalid status transition from ' + order.status + ' to ' + action });
        }
        order.status = action;
        if (action === 'shipped' || action === 'out_for_delivery') {
          if (req.body.tracking_no) order.tracking_no = req.body.tracking_no;
          if (req.body.courier) order.courier = req.body.courier;
          if (req.body.estimated_delivery) order.estimated_delivery = req.body.estimated_delivery;
        }
        if (action === 'delivered') {
          order.actual_delivery = new Date().toISOString();
          order.return_eligible = true;
        }
        store.persist();
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }

      return res.json({ order: enrichLocalOrder(order) });
    }

    // ── Supabase mode ────────────────────────────────────────────────────
    // Admin must use service client (bypasses both RLS and JWT expiry)
    var client = (req.user.role === 'admin' ? (getServiceClient() || req.supabase || supabase) : (req.supabase || supabase));
    var { data: order2, error } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!order2) return res.status(404).json({ error: 'Order not found' });
    if (order2.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (action === 'cancel') {
      var canCancelSup = ['placed', 'confirmed', 'packed'].indexOf(order2.status) >= 0;
      if (!canCancelSup) {
        return res.status(400).json({ error: 'Order cannot be cancelled at this stage.' });
      }
      var { data: upd } = await client
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)
        .select()
        .single();
      res.json({ order: upd });
    } else if (action === 'return') {
      if (order2.status !== 'delivered') {
        return res.status(400).json({ error: 'Return is only available for delivered orders.' });
      }
      var { data: ret } = await client
        .from('orders')
        .update({ status: 'returned', return_reason: req.body.reason || '' })
        .eq('id', orderId)
        .select()
        .single();
      res.json({ order: ret });
    } else if (req.user.role === 'admin') {
      var validTargetsSup = VALID_STATUS_TRANSITIONS[order2.status];
      if (!validTargetsSup || validTargetsSup.indexOf(action) === -1) {
        return res.status(400).json({ error: 'Invalid status transition from ' + order2.status + ' to ' + action });
      }
      var updateData = { status: action };
      // Try to add optional columns (may not exist in schema cache)
      try {
        if (action === 'shipped' || action === 'out_for_delivery') {
          if (req.body.tracking_no) updateData.tracking_no = req.body.tracking_no;
          if (req.body.courier) updateData.courier = req.body.courier;
          if (req.body.estimated_delivery) updateData.estimated_delivery = req.body.estimated_delivery;
        }
        if (action === 'delivered') {
          updateData.actual_delivery = new Date().toISOString();
          updateData.return_eligible = true;
        }
      } catch (e) {}
      var adminClient = getServiceClient();
      var { data: upd2, error: updErr } = await adminClient
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .select()
        .single();
      if (updErr) {
        // If column not found, retry with just status
        if (updErr.code === 'PGRST204') {
          console.warn('[orders] tracking columns not available, retrying with status only');
          var { data: upd3 } = await adminClient
            .from('orders')
            .update({ status: action })
            .eq('id', orderId)
            .select()
            .single();
          return res.json({ order: upd3 });
        }
        console.warn('[orders] status update error:', updErr);
        return res.status(500).json({ error: updErr.message });
      }
      res.json({ order: upd2 });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (e) { next(e); }
});

// ── PUT /api/orders/:id/tracking (admin only) ───────────────────────────────

router.put('/:id/tracking', getUser, requireUser, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    var orderId = Number(req.params.id);
    var { tracking_no, courier, estimated_delivery } = req.body;

    if (MODE === 'local') {
      var order = store.raw.orders.find(function (o) { return o.id === orderId; });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (tracking_no) order.tracking_no = tracking_no;
      if (courier) order.courier = courier;
      if (estimated_delivery) order.estimated_delivery = estimated_delivery;
      store.persist();
      return res.json({ order: enrichLocalOrder(order) });
    }

    var sb = req.supabase || supabase;
    var updateData = {};
    if (tracking_no) updateData.tracking_no = tracking_no;
    if (courier) updateData.courier = courier;
    if (estimated_delivery) updateData.estimated_delivery = estimated_delivery;

    var { data, error } = await sb
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ order: data });
  } catch (e) { next(e); }
});

// ── POST /api/orders/:id/review (write review for a product in the order) ───

router.post('/:id/review', getUser, requireUser, async (req, res, next) => {
  try {
    var orderId = Number(req.params.id);
    var { product_id, rating, title, review } = req.body;

    if (!product_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Valid product_id and rating (1-5) are required' });
    }

    // Verify this order belongs to user and contains the product and is delivered
    var order = null;

    if (MODE === 'local') {
      order = store.raw.orders.find(function (o) { return o.id === orderId; });
      if (!order || order.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Order not found' });
      }
    } else {
      var sb = req.supabase || supabase;
      var { data: order2, error } = await sb
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!order2) return res.status(404).json({ error: 'Order not found' });
      order = order2;
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'Can only review delivered products' });
    }
    var hasItem = (order.items || []).some(function (i) { return String(i.product_id) === String(product_id); });
    if (!hasItem) return res.status(400).json({ error: 'This product was not in your order' });

    var result = await submitReview(req.user, { product_id: product_id, rating: rating, title: title, review: review, order_id: orderId, verified_order: order });
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json(result.review);
  } catch (e) { next(e); }
});

// ── GET /api/orders/:id/invoice ─────────────────────────────────────────────

router.get('/:id/invoice', getUser, requireUser, async (req, res, next) => {
  try {
    var orderId = Number(req.params.id);
    var sb = req.supabase || supabase;

    if (MODE === 'local') {
      var order = store.raw.orders.find(function (o) { return o.id === orderId; });
      if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      // Return enriched data for invoice
      var profile = store.raw.profiles.find(function (p) { return p.id === order.user_id; });
      return res.json({ order: enrichLocalOrder(order), profile: profile });
    }

    var query = sb.from('orders').select('*').eq('id', orderId);
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    var { data: order2, error } = await query.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!order2) return res.status(404).json({ error: 'Order not found' });

    var { data: profile } = await sb.from('profiles').select('*').eq('id', order2.user_id).single();

    res.json({ order: order2, profile: profile || {} });
  } catch (e) { next(e); }
});

module.exports = router;
