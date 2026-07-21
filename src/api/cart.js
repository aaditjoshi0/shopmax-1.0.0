var express = require('express');
var router = express.Router();
var { supabase, MODE } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser } = require('../middleware/auth');

function guestId(req, res) {
  var gid = req.signedCookies && req.signedCookies.sm_guest;
  if (!gid) {
    gid = 'guest-' + store.uid();
    res.cookie('sm_guest', gid, { signed: true, httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  }
  return gid;
}

function cartResponse(items) {
  var subtotal = items.reduce(function (s, i) { return s + Number(i.price) * Number(i.quantity || 1); }, 0);
  var count = items.reduce(function (s, i) { return s + Number(i.quantity || 1); }, 0);
  return { items: items, subtotal: Number(subtotal.toFixed(2)), count: count };
}

function localOwnerKey(req, res) {
  if (MODE === 'local') return req.user ? 'user:' + req.user.id : guestId(req, res);
  return 'guest:' + guestId(req, res);
}

function localFindCart(owner) {
  var cart = store.raw.carts.find(function (c) { return c.owner === owner; });
  if (!cart) {
    cart = { id: store.uid(), owner: owner, items: [] };
    store.raw.carts.push(cart);
    store.persist();
  }
  return cart;
}

async function sbGetOrCreateCart(userId, sb) {
  var { data: existing, error: selErr } = await sb
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (selErr) throw new Error('Cart lookup failed: ' + selErr.message);
  if (existing) return existing;

  var { data: created, error: insErr } = await sb
    .from('carts')
    .insert({ user_id: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('id')
    .single();

  if (insErr) throw new Error('Cart creation failed: ' + insErr.message);
  return created;
}

async function sbFetchItems(cartId, sb) {
  var { data, error } = await sb
    .from('cart_items')
    .select('*')
    .eq('cart_id', cartId);
  if (error) throw new Error('Fetch cart items failed: ' + error.message);
  return data || [];
}

async function sbTouchCart(cartId, sb) {
  await sb.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cartId);
}

function validationError(msg) {
  var err = new Error(msg);
  err.statusCode = 400;
  return err;
}

async function sbValidateProduct(b, requestedQty, sb) {
  if (!b.product_id) return null;

  var { data: product, error: pErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', b.product_id)
    .maybeSingle();

  if (pErr) throw validationError('Product not found.');
  if (!product) throw validationError('Product not found.');
  if ((product.status || 'published') !== 'published') throw validationError('This product is not available for purchase.');
  if (product.stock < 1) throw validationError('This product is out of stock.');
  if (requestedQty && requestedQty > product.stock) throw validationError('Only ' + product.stock + ' available.');

  if (b.size && product.sizes && product.sizes.length > 0 && !product.sizes.includes(b.size)) {
    throw validationError('Invalid size "' + b.size + '". Available: ' + product.sizes.join(', '));
  }

  var colorName = b.color || '';
  if (colorName && product.colors && product.colors.length > 0) {
    var validColor = product.colors.some(function (c) {
      var name = typeof c === 'object' ? (c.name || '') : String(c || '');
      return name === colorName;
    });
    if (!validColor) throw validationError('Invalid color "' + colorName + '".');
  }

  return product;
}

// ── GET /api/cart ──────────────────────────────────────────────────────────

router.get('/', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var cart = localFindCart(localOwnerKey(req, res));
      return res.json(cartResponse(cart.items));
    }

    if (req.user) {
      var sb = req.supabase || supabase;
      var userCart = await sbGetOrCreateCart(req.user.id, sb);
      var items = await sbFetchItems(userCart.id, sb);
      return res.json(cartResponse(items));
    }

    var cart2 = localFindCart(localOwnerKey(req, res));
    res.json(cartResponse(cart2.items));
  } catch (e) { next(e); }
});

// ── POST /api/cart/items ───────────────────────────────────────────────────

router.post('/items', getUser, async (req, res, next) => {
  try {
    var b = req.body || {};
    if (!b.name || b.price == null) return res.status(400).json({ error: 'name and price are required' });
    var quantity = Math.max(1, Number(b.quantity) || 1);

    if (MODE === 'local') {
      var item = {
        id: store.uid(),
        product_id: b.product_id || null,
        variant_id: b.variant_id || null,
        name: b.name,
        price: Number(b.price),
        image_url: b.image_url || null,
        size: b.size || null,
        color: b.color || '',
        quantity: quantity,
        meta: b.meta || null
      };

      // Validate variant stock if variant_id is provided
      if (item.variant_id) {
        var variant = store.raw.variants.find(function (v) { return v.id === item.variant_id; });
        if (!variant) return res.status(400).json({ error: 'Variant not found.' });
        if (variant.status !== 'published') return res.status(400).json({ error: 'This variant is not available.' });
        if (variant.stock < 1) return res.status(400).json({ error: 'This variant is out of stock.' });
        if (quantity > variant.stock) return res.status(400).json({ error: 'Only ' + variant.stock + ' of this variant available.' });
        item.price = Number(b.price) || variant.price;
        if (!item.size) item.size = variant.size || null;
        if (!item.color) item.color = variant.color || '';
      } else if (b.product_id) {
        var product = store.raw.products.find(function (p) { return p.id === b.product_id; });
        if (product) {
          if ((product.status || 'published') !== 'published') return res.status(400).json({ error: 'This product is not available for purchase.' });
          if (product.stock < 1) return res.status(400).json({ error: 'This product is out of stock.' });
          if (quantity > product.stock) return res.status(400).json({ error: 'Only ' + product.stock + ' available.' });
        }
      }

      var cart = localFindCart(localOwnerKey(req, res));
      var match = cart.items.find(function (i) {
        if (item.variant_id && i.variant_id === item.variant_id) return true;
        return (item.product_id && i.product_id === item.product_id && (i.size || null) === (item.size || null) && (i.color || '') === (item.color || '')) ||
          (item.meta && item.meta.design_id && i.meta && i.meta.design_id === item.meta.design_id);
      });
      if (match) match.quantity += item.quantity;
      else cart.items.push(item);
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    // Supabase mode
    var sb2 = req.supabase || supabase;

    if (req.user) {
      // If variant_id provided, validate variant stock; otherwise validate product stock
      if (b.variant_id) {
        var { data: variant } = await sb2.from('product_variants').select('*').eq('id', b.variant_id).maybeSingle();
        if (!variant) return res.status(400).json({ error: 'Variant not found.' });
        if (variant.status !== 'published') return res.status(400).json({ error: 'This variant is not available.' });
        if (variant.stock < 1) return res.status(400).json({ error: 'This variant is out of stock.' });
        if (quantity > variant.stock) return res.status(400).json({ error: 'Only ' + variant.stock + ' of this variant available.' });
      } else {
        await sbValidateProduct(b, quantity, sb2);
      }

      var cart2 = await sbGetOrCreateCart(req.user.id, sb2);

      var colorName = b.color || '';
      var queryMatch = sb2.from('cart_items').select('id, quantity').eq('product_id', b.product_id).eq('size', b.size || '').eq('color', colorName).eq('cart_id', cart2.id);
      var { data: existingRows } = await queryMatch;

      var existingQty = existingRows && existingRows.length > 0 ? existingRows[0].quantity : 0;
      var totalQty = existingQty + quantity;

      if (b.variant_id) {
        var { data: v2 } = await sb2.from('product_variants').select('stock').eq('id', b.variant_id).single();
        if (totalQty > v2.stock) {
          var avail = Math.max(0, v2.stock - existingQty);
          if (avail <= 0) return res.status(400).json({ error: 'You already have the maximum available quantity in your cart.' });
          return res.status(400).json({ error: 'Only ' + avail + ' more available.' });
        }
      } else {
        var product2 = await sbValidateProduct(b, quantity, sb2);
        if (totalQty > product2.stock) {
          var available = Math.max(0, product2.stock - existingQty);
          if (available <= 0) return res.status(400).json({ error: 'You already have the maximum available quantity in your cart.' });
          return res.status(400).json({ error: 'Only ' + available + ' more available.' });
        }
      }

      if (existingRows && existingRows.length > 0) {
        var updFields = { quantity: totalQty };
        if (b.variant_id) {
          updFields.meta = existingRows[0].meta ? { ...existingRows[0].meta, variant_id: b.variant_id } : { variant_id: b.variant_id };
        }
        var { error: updErr } = await sb2.from('cart_items').update(updFields).eq('id', existingRows[0].id);
        if (updErr) throw new Error('Failed to update cart item: ' + updErr.message);
      } else {
        var cartMeta = b.meta ? { ...b.meta } : {};
        if (b.variant_id) cartMeta.variant_id = b.variant_id;
        var insertObj = {
          cart_id: cart2.id,
          product_id: b.product_id,
          name: b.name,
          price: Number(b.price),
          image_url: b.image_url || null,
          size: b.size || '',
          color: colorName,
          quantity: totalQty,
          meta: cartMeta
        };
        var { error: insErr } = await sb2.from('cart_items').insert(insertObj);
        if (insErr) throw new Error('Failed to add item to cart: ' + insErr.message);
      }

      await sbTouchCart(cart2.id, sb2);
      var items2 = await sbFetchItems(cart2.id, sb2);
      return res.json(cartResponse(items2));
    }

    // Guest in supabase mode — use localStore
    if (b.variant_id) {
      var { data: guestV } = await sb2.from('product_variants').select('*').eq('id', b.variant_id).maybeSingle();
      if (!guestV) return res.status(400).json({ error: 'Variant not found.' });
      if (guestV.status !== 'published') return res.status(400).json({ error: 'This variant is not available.' });
      if (guestV.stock < 1) return res.status(400).json({ error: 'This variant is out of stock.' });
      if (quantity > guestV.stock) return res.status(400).json({ error: 'Only ' + guestV.stock + ' of this variant available.' });
    } else if (b.product_id) {
      await sbValidateProduct(b, quantity, sb2);
    }
    var gItem = {
      id: store.uid(),
      product_id: b.product_id || null,
      variant_id: b.variant_id || null,
      name: b.name,
      price: Number(b.price),
      image_url: b.image_url || null,
      size: b.size || null,
      color: b.color || '',
      quantity: quantity,
      meta: b.meta || null
    };
    var gCart = localFindCart(localOwnerKey(req, res));
    var gMatch = gCart.items.find(function (i) {
      if (gItem.variant_id && i.variant_id === gItem.variant_id) return true;
      return (gItem.product_id && i.product_id === gItem.product_id && (i.size || null) === (gItem.size || null) && (i.color || '') === (gItem.color || '')) ||
        (gItem.meta && gItem.meta.design_id && i.meta && i.meta.design_id === gItem.meta.design_id);
    });
    if (gMatch) {
      if (b.variant_id) {
        var { data: guestV2 } = await sb2.from('product_variants').select('stock').eq('id', b.variant_id).single();
        var gTotal = gMatch.quantity + quantity;
        if (gTotal > guestV2.stock) {
          var gAvail = Math.max(0, guestV2.stock - gMatch.quantity);
          if (gAvail <= 0) return res.status(400).json({ error: 'You already have the maximum available quantity in your cart.' });
          return res.status(400).json({ error: 'Only ' + gAvail + ' more available.' });
        }
      } else if (b.product_id) {
        await sbValidateProduct(b, gMatch.quantity + quantity, sb2);
      }
      gMatch.quantity += gItem.quantity;
    } else gCart.items.push(gItem);
    store.persist();
    res.json(cartResponse(gCart.items));
  } catch (e) { next(e); }
});

// ── PATCH /api/cart/items/:id ──────────────────────────────────────────────

router.patch('/items/:id', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var cart = localFindCart(localOwnerKey(req, res));
      var item = cart.items.find(function (i) { return i.id === req.params.id; });
      if (!item) return res.status(404).json({ error: 'Item not in cart' });
      if (req.body.quantity != null) item.quantity = Math.max(1, Number(req.body.quantity));
      if (req.body.size != null) item.size = req.body.size;
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    var sb = req.supabase || supabase;

    if (req.user) {
      var cart2 = await sbGetOrCreateCart(req.user.id, sb);

      var { data: dbItem, error: findErr } = await sb
        .from('cart_items')
        .select('*')
        .eq('id', req.params.id)
        .eq('cart_id', cart2.id)
        .maybeSingle();

      if (findErr) throw new Error(findErr.message);
      if (!dbItem) return res.status(404).json({ error: 'Item not in cart' });

      var updates = {};
      if (req.body.quantity != null) {
        var qty = Math.max(1, Number(req.body.quantity));
        if (qty > dbItem.quantity && dbItem.product_id) {
          var { data: product } = await sb.from('products').select('stock, status').eq('id', dbItem.product_id).single();
          if (product && product.status !== 'published') return res.status(400).json({ error: 'This product is no longer available.' });
          if (product && qty > product.stock) return res.status(400).json({ error: 'Only ' + product.stock + ' available.' });
        }
        updates.quantity = qty;
      }
      if (req.body.size != null) updates.size = req.body.size;

      var { error: updErr } = await sb.from('cart_items').update(updates).eq('id', req.params.id);
      if (updErr) throw new Error(updErr.message);

      await sbTouchCart(cart2.id, sb);
      var items = await sbFetchItems(cart2.id, sb);
      return res.json(cartResponse(items));
    }

    // Guest in supabase mode — use localStore
    var gCart = localFindCart(localOwnerKey(req, res));
    var gItem = gCart.items.find(function (i) { return i.id === req.params.id; });
    if (!gItem) return res.status(404).json({ error: 'Item not in cart' });
    if (req.body.quantity != null) gItem.quantity = Math.max(1, Number(req.body.quantity));
    if (req.body.size != null) gItem.size = req.body.size;
    store.persist();
    res.json(cartResponse(gCart.items));
  } catch (e) { next(e); }
});

// ── DELETE /api/cart/items/:id ─────────────────────────────────────────────

router.delete('/items/:id', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var cart = localFindCart(localOwnerKey(req, res));
      cart.items = cart.items.filter(function (i) { return i.id !== req.params.id; });
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    var sb = req.supabase || supabase;

    if (req.user) {
      var cart2 = await sbGetOrCreateCart(req.user.id, sb);
      var { error: delErr } = await sb.from('cart_items').delete().eq('id', req.params.id).eq('cart_id', cart2.id);
      if (delErr) throw new Error(delErr.message);
      await sbTouchCart(cart2.id, sb);
      var items = await sbFetchItems(cart2.id, sb);
      return res.json(cartResponse(items));
    }

    var gCart = localFindCart(localOwnerKey(req, res));
    gCart.items = gCart.items.filter(function (i) { return i.id !== req.params.id; });
    store.persist();
    res.json(cartResponse(gCart.items));
  } catch (e) { next(e); }
});

// ── POST /api/cart/clear ───────────────────────────────────────────────────

router.post('/clear', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var cart = localFindCart(localOwnerKey(req, res));
      cart.items = [];
      store.persist();
      return res.json(cartResponse([]));
    }

    var sb = req.supabase || supabase;

    if (req.user) {
      var cart2 = await sbGetOrCreateCart(req.user.id, sb);
      var { error: delErr } = await sb.from('cart_items').delete().eq('cart_id', cart2.id);
      if (delErr) throw new Error(delErr.message);
      await sbTouchCart(cart2.id, sb);
      return res.json(cartResponse([]));
    }

    var gCart = localFindCart(localOwnerKey(req, res));
    gCart.items = [];
    store.persist();
    res.json(cartResponse([]));
  } catch (e) { next(e); }
});

// ── POST /api/cart/merge ───────────────────────────────────────────────────

router.post('/merge', getUser, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'You must be logged in to merge.' });

    var guestCookie = req.signedCookies && req.signedCookies.sm_guest;
    if (!guestCookie) return res.json(cartResponse([]));

    if (MODE === 'local') {
      var guestCart = store.raw.carts.find(function (c) { return c.owner === 'guest:' + guestCookie; });
      if (!guestCart || !guestCart.items.length) return res.json(cartResponse([]));

      var guestCartAlt = store.raw.carts.find(function (c) { return c.owner === guestCookie; });
      var sourceCart = guestCart.items.length ? guestCart : (guestCartAlt || { items: [] });

      var userCart = localFindCart('user:' + req.user.id);
      for (var gi = 0; gi < sourceCart.items.length; gi++) {
        var gItem = sourceCart.items[gi];
        var match = userCart.items.find(function (i) {
          if (gItem.variant_id && i.variant_id === gItem.variant_id) return true;
          return (gItem.product_id && i.product_id === gItem.product_id && (i.size || null) === (gItem.size || null) && (i.color || '') === (gItem.color || ''));
        });
        if (match) match.quantity += gItem.quantity;
        else userCart.items.push({ ...gItem });
      }
      store.raw.carts = store.raw.carts.filter(function (c) { return c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie; });
      store.persist();
      res.clearCookie('sm_guest');
      return res.json(cartResponse(userCart.items));
    }

    // Supabase mode — merge from localStore guest cart into Supabase user cart
    var sb = req.supabase || supabase;
    var guestCart2 = store.raw.carts.find(function (c) { return c.owner === 'guest:' + guestCookie; });
    var guestCartAlt2 = store.raw.carts.find(function (c) { return c.owner === guestCookie; });
    var sourceCart2 = (guestCart2 && guestCart2.items.length) ? guestCart2 : (guestCartAlt2 || { items: [] });

    if (!sourceCart2.items || sourceCart2.items.length === 0) {
      res.clearCookie('sm_guest');
      return res.json(cartResponse([]));
    }

    var userCart2 = await sbGetOrCreateCart(req.user.id, sb);

    for (var gi2 = 0; gi2 < sourceCart2.items.length; gi2++) {
      var gItem2 = sourceCart2.items[gi2];
      var query = sb.from('cart_items').select('id, quantity').eq('cart_id', userCart2.id);
      if (gItem2.product_id) {
        query = query.eq('product_id', gItem2.product_id).eq('size', gItem2.size || '').eq('color', gItem2.color || '');
      }
      var { data: existing } = await query.maybeSingle();

      if (existing) {
        var { error: mUpdErr } = await sb.from('cart_items').update({ quantity: existing.quantity + gItem2.quantity }).eq('id', existing.id);
        if (mUpdErr) throw new Error('Failed to update merged item: ' + mUpdErr.message);
      } else {
        var mergeMeta = gItem2.meta ? { ...gItem2.meta } : {};
        if (gItem2.variant_id) mergeMeta.variant_id = gItem2.variant_id;
        var mergeInsert = {
          cart_id: userCart2.id,
          product_id: gItem2.product_id,
          name: gItem2.name,
          price: Number(gItem2.price),
          image_url: gItem2.image_url || null,
          size: gItem2.size || '',
          color: gItem2.color || '',
          quantity: gItem2.quantity,
          meta: mergeMeta
        };
        var { error: mInsErr } = await sb.from('cart_items').insert(mergeInsert);
        if (mInsErr) throw new Error('Failed to add merged item: ' + mInsErr.message);
      }
    }

    store.raw.carts = store.raw.carts.filter(function (c) { return c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie; });
    store.persist();
    await sbTouchCart(userCart2.id, sb);
    res.clearCookie('sm_guest');

    var items = await sbFetchItems(userCart2.id, sb);
    res.json(cartResponse(items));
  } catch (e) { next(e); }
});

module.exports = router;
