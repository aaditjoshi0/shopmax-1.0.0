// Cart API — works in both "local" (file JSON) and "supabase" (Postgres) mode.
//
//  GET    /api/cart                      -> { items, subtotal, count }
//  POST   /api/cart/items                -> add item { product_id?, name, price, image_url, size?, color?, quantity?, meta? }
//  PATCH  /api/cart/items/:id            -> update { quantity, size? }
//  DELETE /api/cart/items/:id            -> remove item
//  POST   /api/cart/clear               -> empty the cart
//  POST   /api/cart/merge               -> merge guest cart into user cart (called after login)
//
// Logged-in users: cart stored in Supabase (carts + cart_items tables).
// Guests:          cart stored in localStore (JSON file) until login, then merged.

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser } = require('../middleware/auth');

// ── Helpers shared by local + supabase paths ────────────────────────────────

function guestId(req, res) {
  let gid = req.signedCookies && req.signedCookies.sm_guest;
  if (!gid) {
    gid = 'guest-' + store.uid();
    res.cookie('sm_guest', gid, { signed: true, httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  }
  return gid;
}

function cartResponse(items) {
  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity || 1), 0);
  const count = items.reduce((s, i) => s + Number(i.quantity || 1), 0);
  return { items, subtotal: Number(subtotal.toFixed(2)), count };
}

// ── LocalStore helpers (used for guests in supabase mode, and always in local mode) ──

function localOwnerKey(req, res) {
  if (MODE === 'local') return req.user ? 'user:' + req.user.id : guestId(req, res);
  // In supabase mode, localStore is only for guests
  return 'guest:' + guestId(req, res);
}

function localFindCart(owner) {
  let cart = store.raw.carts.find(c => c.owner === owner);
  if (!cart) {
    cart = { id: store.uid(), owner, items: [] };
    store.raw.carts.push(cart);
    store.persist();
  }
  return cart;
}

// ── Supabase helpers (only for logged-in users) ─────────────────────────────

async function sbGetOrCreateCart(userId) {
  const { data: existing, error: selErr } = await supabase
    .from('carts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (selErr) throw new Error('Cart lookup failed: ' + selErr.message);
  if (existing) return existing;

  const { data: created, error: insErr } = await supabase
    .from('carts')
    .insert({ user_id: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .select('id')
    .single();

  if (insErr) throw new Error('Cart creation failed: ' + insErr.message);
  return created;
}

async function sbFetchItems(cartId) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('*')
    .eq('cart_id', cartId);
  if (error) throw new Error('Fetch cart items failed: ' + error.message);
  return data || [];
}

async function sbTouchCart(cartId) {
  await supabase.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cartId);
}

function validationError(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

async function sbValidateProduct(b, requestedQty) {
  if (!b.product_id) return null;

  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('id, name, price, stock, status, sizes, colors')
    .eq('id', b.product_id)
    .single();

  if (pErr || !product) throw validationError('Product not found.');
  if (product.status !== 'published') throw validationError('This product is not available for purchase.');
  if (product.stock < 1) throw validationError('This product is out of stock.');
  if (requestedQty && requestedQty > product.stock) throw validationError(`Only ${product.stock} available.`);

  if (b.size && product.sizes && product.sizes.length > 0 && !product.sizes.includes(b.size)) {
    throw validationError(`Invalid size "${b.size}". Available: ${product.sizes.join(', ')}`);
  }

  const colorName = b.color || '';
  if (colorName && product.colors && product.colors.length > 0) {
    const validColor = product.colors.some(c => (c.name || '') === colorName);
    if (!validColor) throw validationError(`Invalid color "${colorName}".`);
  }

  return product;
}

// ── GET /api/cart ──────────────────────────────────────────────────────────

router.get('/', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const cart = localFindCart(localOwnerKey(req, res));
      return res.json(cartResponse(cart.items));
    }

    // Supabase mode
    if (req.user) {
      const cart = await sbGetOrCreateCart(req.user.id);
      const items = await sbFetchItems(cart.id);
      return res.json(cartResponse(items));
    }

    // Guest in supabase mode — use localStore
    const cart = localFindCart(localOwnerKey(req, res));
    res.json(cartResponse(cart.items));
  } catch (e) { next(e); }
});

// ── POST /api/cart/items ───────────────────────────────────────────────────

router.post('/items', getUser, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || b.price == null) return res.status(400).json({ error: 'name and price are required' });
    const quantity = Math.max(1, Number(b.quantity) || 1);

    if (MODE === 'local') {
      const item = {
        id: store.uid(),
        product_id: b.product_id || null,
        name: b.name,
        price: Number(b.price),
        image_url: b.image_url || null,
        size: b.size || null,
        color: b.color || '',
        quantity,
        meta: b.meta || null
      };
      const cart = localFindCart(localOwnerKey(req, res));
      const match = cart.items.find(i =>
        (item.product_id && i.product_id === item.product_id && (i.size || null) === (item.size || null) && (i.color || '') === (item.color || '')) ||
        (item.meta && item.meta.design_id && i.meta && i.meta.design_id === item.meta.design_id)
      );
      if (match) match.quantity += item.quantity;
      else cart.items.push(item);
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    // Supabase mode
    if (req.user) {
      // Validate product, stock, size, color
      const product = await sbValidateProduct(b, quantity);

      const cart = await sbGetOrCreateCart(req.user.id);

      const colorName = b.color || '';
      const { data: existingRows } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', cart.id)
        .eq('product_id', b.product_id)
        .eq('size', b.size || '')
        .eq('color', colorName);

      const existingQty = existingRows && existingRows.length > 0 ? existingRows[0].quantity : 0;
      const totalQty = existingQty + quantity;

      if (totalQty > product.stock) {
        const available = Math.max(0, product.stock - existingQty);
        if (available <= 0) return res.status(400).json({ error: 'You already have the maximum available quantity in your cart.' });
        return res.status(400).json({ error: `Only ${available} more available.` });
      }

      if (existingRows && existingRows.length > 0) {
        await supabase.from('cart_items').update({ quantity: totalQty }).eq('id', existingRows[0].id);
      } else {
        await supabase.from('cart_items').insert({
          cart_id: cart.id,
          product_id: b.product_id,
          name: product.name,
          price: Number(b.price),
          image_url: b.image_url || null,
          size: b.size || '',
          color: colorName,
          quantity: totalQty,
          meta: b.meta || null
        });
      }

      await sbTouchCart(cart.id);
      const items = await sbFetchItems(cart.id);
      return res.json(cartResponse(items));
    }

    // Guest in supabase mode — validate stock, then use localStore
    if (b.product_id) {
      await sbValidateProduct(b, quantity);
    }
    const item = {
      id: store.uid(),
      product_id: b.product_id || null,
      name: b.name,
      price: Number(b.price),
      image_url: b.image_url || null,
      size: b.size || null,
      color: b.color || '',
      quantity,
      meta: b.meta || null
    };
    const cart = localFindCart(localOwnerKey(req, res));
    const match = cart.items.find(i =>
      (item.product_id && i.product_id === item.product_id && (i.size || null) === (item.size || null) && (i.color || '') === (item.color || '')) ||
      (item.meta && item.meta.design_id && i.meta && i.meta.design_id === item.meta.design_id)
    );
    if (match) {
      // Check stock against total (existing + new)
      if (b.product_id) {
        const product = await sbValidateProduct(b, match.quantity + quantity);
      }
      match.quantity += item.quantity;
    } else cart.items.push(item);
    store.persist();
    res.json(cartResponse(cart.items));
  } catch (e) { next(e); }
});

// ── PATCH /api/cart/items/:id ──────────────────────────────────────────────

router.patch('/items/:id', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const cart = localFindCart(localOwnerKey(req, res));
      const item = cart.items.find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not in cart' });
      if (req.body.quantity != null) item.quantity = Math.max(1, Number(req.body.quantity));
      if (req.body.size != null) item.size = req.body.size;
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    if (req.user) {
      const cart = await sbGetOrCreateCart(req.user.id);

      const { data: item, error: findErr } = await supabase
        .from('cart_items')
        .select('*')
        .eq('id', req.params.id)
        .eq('cart_id', cart.id)
        .maybeSingle();

      if (findErr) throw new Error(findErr.message);
      if (!item) return res.status(404).json({ error: 'Item not in cart' });

      const updates = {};
      if (req.body.quantity != null) {
        const qty = Math.max(1, Number(req.body.quantity));
        if (qty > item.quantity && item.product_id) {
          const { data: product } = await supabase.from('products').select('stock, status').eq('id', item.product_id).single();
          if (product && product.status !== 'published') return res.status(400).json({ error: 'This product is no longer available.' });
          if (product && qty > product.stock) return res.status(400).json({ error: `Only ${product.stock} available.` });
        }
        updates.quantity = qty;
      }
      if (req.body.size != null) updates.size = req.body.size;

      const { error: updErr } = await supabase.from('cart_items').update(updates).eq('id', req.params.id);
      if (updErr) throw new Error(updErr.message);

      await sbTouchCart(cart.id);
      const items = await sbFetchItems(cart.id);
      return res.json(cartResponse(items));
    }

    // Guest in supabase mode — use localStore
    const cart = localFindCart(localOwnerKey(req, res));
    const item = cart.items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not in cart' });
    if (req.body.quantity != null) item.quantity = Math.max(1, Number(req.body.quantity));
    if (req.body.size != null) item.size = req.body.size;
    store.persist();
    res.json(cartResponse(cart.items));
  } catch (e) { next(e); }
});

// ── DELETE /api/cart/items/:id ─────────────────────────────────────────────

router.delete('/items/:id', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const cart = localFindCart(localOwnerKey(req, res));
      cart.items = cart.items.filter(i => i.id !== req.params.id);
      store.persist();
      return res.json(cartResponse(cart.items));
    }

    if (req.user) {
      const cart = await sbGetOrCreateCart(req.user.id);
      const { error: delErr } = await supabase.from('cart_items').delete().eq('id', req.params.id).eq('cart_id', cart.id);
      if (delErr) throw new Error(delErr.message);
      await sbTouchCart(cart.id);
      const items = await sbFetchItems(cart.id);
      return res.json(cartResponse(items));
    }

    // Guest in supabase mode — use localStore
    const cart = localFindCart(localOwnerKey(req, res));
    cart.items = cart.items.filter(i => i.id !== req.params.id);
    store.persist();
    res.json(cartResponse(cart.items));
  } catch (e) { next(e); }
});

// ── POST /api/cart/clear ───────────────────────────────────────────────────

router.post('/clear', getUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const cart = localFindCart(localOwnerKey(req, res));
      cart.items = [];
      store.persist();
      return res.json(cartResponse([]));
    }

    if (req.user) {
      const cart = await sbGetOrCreateCart(req.user.id);
      const { error: delErr } = await supabase.from('cart_items').delete().eq('cart_id', cart.id);
      if (delErr) throw new Error(delErr.message);
      await sbTouchCart(cart.id);
      return res.json(cartResponse([]));
    }

    // Guest in supabase mode — use localStore
    const cart = localFindCart(localOwnerKey(req, res));
    cart.items = [];
    store.persist();
    res.json(cartResponse([]));
  } catch (e) { next(e); }
});

// ── POST /api/cart/merge (guest cart -> user cart, after login) ────────────

router.post('/merge', getUser, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'You must be logged in to merge.' });

    const guestCookie = req.signedCookies && req.signedCookies.sm_guest;
    if (!guestCookie) return res.json(cartResponse([]));

    if (MODE === 'local') {
      const guestCart = store.raw.carts.find(c => c.owner === 'guest:' + guestCookie);
      if (!guestCart || !guestCart.items.length) return res.json(cartResponse([]));

      // Local mode: also find by 'guest-' prefix (legacy format)
      const guestCartAlt = store.raw.carts.find(c => c.owner === guestCookie);
      const sourceCart = guestCart.items.length ? guestCart : (guestCartAlt || { items: [] });

      const userCart = localFindCart('user:' + req.user.id);
      for (const gItem of sourceCart.items) {
        const match = userCart.items.find(i =>
          (gItem.product_id && i.product_id === gItem.product_id && (i.size || null) === (gItem.size || null) && (i.color || '') === (gItem.color || ''))
        );
        if (match) match.quantity += gItem.quantity;
        else userCart.items.push({ ...gItem });
      }
      store.raw.carts = store.raw.carts.filter(c => c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie);
      store.persist();
      res.clearCookie('sm_guest');
      return res.json(cartResponse(userCart.items));
    }

    // Supabase mode — merge from localStore guest cart into Supabase user cart
    const guestCart = store.raw.carts.find(c => c.owner === 'guest:' + guestCookie);
    const guestCartAlt = store.raw.carts.find(c => c.owner === guestCookie);
    const sourceCart = (guestCart && guestCart.items.length) ? guestCart : (guestCartAlt || { items: [] });

    if (!sourceCart.items || sourceCart.items.length === 0) {
      res.clearCookie('sm_guest');
      return res.json(cartResponse([]));
    }

    const userCart = await sbGetOrCreateCart(req.user.id);

    for (const gItem of sourceCart.items) {
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', userCart.id)
        .eq('product_id', gItem.product_id)
        .eq('size', gItem.size || '')
        .eq('color', gItem.color || '')
        .maybeSingle();

      if (existing) {
        await supabase.from('cart_items').update({ quantity: existing.quantity + gItem.quantity }).eq('id', existing.id);
      } else {
        await supabase.from('cart_items').insert({
          cart_id: userCart.id,
          product_id: gItem.product_id,
          name: gItem.name,
          price: Number(gItem.price),
          image_url: gItem.image_url || null,
          size: gItem.size || '',
          color: gItem.color || '',
          quantity: gItem.quantity,
          meta: gItem.meta || null
        });
      }
    }

    // Clean up guest cart from localStore
    store.raw.carts = store.raw.carts.filter(c => c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie);
    store.persist();
    await sbTouchCart(userCart.id);
    res.clearCookie('sm_guest');

    const items = await sbFetchItems(userCart.id);
    res.json(cartResponse(items));
  } catch (e) { next(e); }
});

module.exports = router;
