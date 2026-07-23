const express = require('express');
const router = express.Router();
const { supabase, MODE, getAuthedClient } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser, requireAdmin, fetchUserRole } = require('../middleware/auth');

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

function setSession(res, user, accessToken, refreshToken) {
  var payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    role: user.role || 'customer'
  };
  if (MODE === 'supabase') {
    payload.access_token = accessToken;
    payload.refresh_token = refreshToken;
  }
  res.cookie('sm_session', payload, {
    signed: true,
    httpOnly: true,
    maxAge: ONE_WEEK,
    sameSite: 'lax'
  });
}

function setAdminSession(res, user, accessToken, refreshToken) {
  var payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    role: user.role || 'admin'
  };
  if (MODE === 'supabase') {
    payload.access_token = accessToken;
    payload.refresh_token = refreshToken;
  }
  res.cookie('sm_admin_session', payload, {
    signed: true,
    httpOnly: true,
    maxAge: ONE_WEEK,
    sameSite: 'lax'
  });
}

async function mergeGuestCart(req, res, userId, accessToken) {
  var guestCookie = req.signedCookies && req.signedCookies.sm_guest;
  if (!guestCookie) return;

  try {
    var guestCart = store.raw.carts.find(c => c.owner === 'guest:' + guestCookie);
    var guestCartAlt = store.raw.carts.find(c => c.owner === guestCookie);
    var source = (guestCart && guestCart.items.length) ? guestCart : (guestCartAlt || { items: [] });

    if (!source.items || source.items.length === 0) return;

    if (MODE === 'local') {
      var userCart = store.raw.carts.find(c => c.owner === 'user:' + userId);
      if (userCart) {
        for (var gi = 0; gi < source.items.length; gi++) {
          var gItem = source.items[gi];
          var match = userCart.items.find(function (i) {
            return (gItem.product_id && i.product_id === gItem.product_id && (i.size || null) === (gItem.size || null) && (i.color || '') === (gItem.color || ''));
          });
          if (match) match.quantity += gItem.quantity;
          else userCart.items.push({ ...gItem });
        }
      } else {
        store.raw.carts.push({ id: store.uid(), owner: 'user:' + userId, items: source.items.map(function (i) { return { ...i }; }) });
      }
      store.raw.carts = store.raw.carts.filter(function (c) { return c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie; });
      store.persist();
      res.clearCookie('sm_guest');
      return;
    }

    // Supabase mode — merge localStore guest items into Supabase user cart
    var sb = accessToken ? getAuthedClient(accessToken) : supabase;

    var { data: existingUserCart } = await sb
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    var userCartId;
    if (existingUserCart) {
      userCartId = existingUserCart.id;
    } else {
      var { data: newCart, error: cErr } = await sb
        .from('carts')
        .insert({ user_id: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select('id')
        .single();
      if (cErr) throw new Error('Failed to create user cart: ' + cErr.message);
      userCartId = newCart.id;
    }

    for (var gi2 = 0; gi2 < source.items.length; gi2++) {
      var gItem2 = source.items[gi2];
      var { data: existing } = await sb
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', userCartId)
        .eq('product_id', gItem2.product_id)
        .eq('size', gItem2.size || '')
        .eq('color', gItem2.color || '')
        .maybeSingle();

      if (existing) {
        await sb.from('cart_items').update({ quantity: existing.quantity + gItem2.quantity }).eq('id', existing.id);
      } else {
        await sb.from('cart_items').insert({
          cart_id: userCartId,
          product_id: gItem2.product_id,
          name: gItem2.name,
          price: Number(gItem2.price),
          image_url: gItem2.image_url || null,
          size: gItem2.size || '',
          color: gItem2.color || '',
          quantity: gItem2.quantity,
          meta: gItem2.meta || null
        });
      }
    }

    store.raw.carts = store.raw.carts.filter(function (c) { return c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie; });
    store.persist();
    await sb.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', userCartId);
    res.clearCookie('sm_guest');
  } catch (_) {
    // Merge is best-effort — never block login for a cart merge failure
  }
}

// ── Signup ──────────────────────────────────────────────────────────────────

router.post('/signup', async (req, res, next) => {
  try {
    var { email, password, full_name, mobile, birthdate } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (!mobile) return res.status(400).json({ error: 'Mobile number is required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    if (MODE === 'local') {
      var exists = store.raw.users.find(function (u) { return u.email.toLowerCase() === email.toLowerCase(); });
      if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });
      var mobileExists = store.raw.users.find(function (u) { return u.mobile === mobile; });
      if (mobileExists) return res.status(409).json({ error: 'An account with that mobile number already exists.' });
      var id = 'local-' + store.uid();
      var user = { id: id, email: email, full_name: full_name || '', mobile: mobile, birthdate: birthdate || '', password: store.hash(password), role: 'customer', created_at: new Date().toISOString() };
      store.raw.users.push(user);
      store.raw.profiles.push({ id: id, email: email, full_name: full_name || '', mobile: mobile, birthdate: birthdate || '', avatar_url: null, role: 'customer', created_at: user.created_at });
      store.persist();
      var session = { id: id, email: email, name: full_name || email, mobile: mobile, role: 'customer' };
      setSession(res, session);
      await mergeGuestCart(req, res, id);
      return res.json({ user: session });
    }

    // Supabase mode
    var { data, error } = await supabase.auth.signUp({
      email: email, password: password,
      options: { data: { full_name: full_name || '', mobile: mobile || '', birthdate: birthdate || '' } }
    });
    if (error) return res.status(400).json({ error: error.message });
    var u = data.user;
    if (!u) return res.json({ user: null, message: 'Check your email to confirm your account.' });

    var accessToken = null;
    var refreshToken = null;
    if (data.session) {
      accessToken = data.session.access_token;
      refreshToken = data.session.refresh_token;
    }

    var sb = accessToken ? getAuthedClient(accessToken) : supabase;
    await sb.from('profiles').upsert({
      id: u.id, email: u.email, full_name: full_name || '', mobile: mobile || '', birthdate: birthdate || '', role: 'customer'
    }, { onConflict: 'id' });

    var sessUser = { id: u.id, email: u.email, name: full_name || u.email, mobile: mobile || '', role: 'customer' };
    setSession(res, sessUser, accessToken, refreshToken);
    await mergeGuestCart(req, res, u.id, accessToken);
    res.json({ user: sessUser });
  } catch (e) { next(e); }
});

// ── Login ───────────────────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    var { email, mobile, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required.' });
    if (!email && !mobile) return res.status(400).json({ error: 'Email or mobile number is required.' });

    if (MODE === 'local') {
      var user = email
        ? store.raw.users.find(function (u) { return u.email.toLowerCase() === email.toLowerCase(); })
        : store.raw.users.find(function (u) { return u.mobile === mobile; });
      if (!user || user.password !== store.hash(password)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      var userProfile = store.raw.profiles.find(function (p) { return p.id === user.id; });
      var role = (userProfile && userProfile.role) || 'customer';
      var session = { id: user.id, email: user.email, name: user.full_name || user.email, mobile: user.mobile, role: role };
      setSession(res, session);
      await mergeGuestCart(req, res, user.id);
      return res.json({ user: session });
    }

    // Supabase mode
    var loginEmail = email;
    if (!loginEmail && mobile) {
      var { data: profile } = await supabase.from('profiles').select('email').eq('mobile', mobile).single();
      if (!profile || !profile.email) {
        return res.status(401).json({ error: 'No account found with that mobile number.' });
      }
      loginEmail = profile.email;
    }

    var { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: password });
    if (error) return res.status(401).json({ error: error.message });
    var u = data.user;
    var accessToken = data.session.access_token;
    var refreshToken = data.session.refresh_token;

    var sb = getAuthedClient(accessToken);
    var { data: profile } = await sb.from('profiles').select('role').eq('id', u.id).maybeSingle();
    var role = (profile && profile.role) || 'customer';
    var sessUser = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email, mobile: mobile || (u.user_metadata && u.user_metadata.mobile) || '', role: role };
    setSession(res, sessUser, accessToken, refreshToken);
    await mergeGuestCart(req, res, u.id, accessToken);
    res.json({ user: sessUser });
  } catch (e) { next(e); }
});

// ── Logout ──────────────────────────────────────────────────────────────────

router.post('/logout', function (req, res) {
  res.clearCookie('sm_session');
  res.json({ ok: true });
});

// ── Admin login (separate cookie) ───────────────────────────────────────────

router.post('/admin-login', async (req, res, next) => {
  try {
    var { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    if (MODE === 'local') {
      var user = store.raw.users.find(function (u) { return u.email.toLowerCase() === email.toLowerCase(); });
      if (!user || user.password !== store.hash(password)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      var userProfile = store.raw.profiles.find(function (p) { return p.id === user.id; });
      var role = (userProfile && userProfile.role) || 'customer';
      if (role !== 'admin') return res.status(403).json({ error: 'This account does not have admin access.' });
      var session = { id: user.id, email: user.email, name: user.full_name || user.email, mobile: user.mobile, role: role };
      setAdminSession(res, session);
      return res.json({ user: session });
    }

    // Supabase mode
    var { data, error } = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (error) return res.status(401).json({ error: error.message });
    var u = data.user;
    var accessToken = data.session.access_token;
    var refreshToken = data.session.refresh_token;

    var sb = getAuthedClient(accessToken);
    var { data: profile } = await sb.from('profiles').select('role').eq('id', u.id).maybeSingle();
    var role2 = (profile && profile.role) || 'customer';
    if (role2 !== 'admin') return res.status(403).json({ error: 'This account does not have admin access.' });
    var sessUser = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email, mobile: (u.user_metadata && u.user_metadata.mobile) || '', role: role2 };
    setAdminSession(res, sessUser, accessToken, refreshToken);
    res.json({ user: sessUser });
  } catch (e) { next(e); }
});

router.post('/admin-logout', function (req, res) {
  res.clearCookie('sm_admin_session');
  res.json({ ok: true });
});

// ── Me ──────────────────────────────────────────────────────────────────────

router.get('/me', getUser, async function (req, res) {
  try {
    if (req.user && MODE === 'supabase' && req.supabase) {
      var { data: profile } = await req.supabase
        .from('profiles').select('full_name, email, mobile, role')
        .eq('id', req.user.id).maybeSingle();
      if (profile) {
        return res.json({ user: {
          id: req.user.id,
          name: profile.full_name || req.user.name,
          email: profile.email || req.user.email,
          mobile: profile.mobile || req.user.mobile,
          role: profile.role || req.user.role
        }});
      }
    }
    if (req.user && MODE === 'local') {
      var p = store.raw.profiles.find(function (x) { return x.id === req.user.id; });
      if (p) {
        return res.json({ user: {
          id: req.user.id,
          name: p.full_name || req.user.name,
          email: p.email || req.user.email,
          mobile: p.mobile || req.user.mobile,
          role: p.role || req.user.role
        }});
      }
    }
  } catch (_) {}
  res.json({ user: req.user });
});

// ── Admin Me ──────────────────────────────────────────────────────────────

router.get('/admin-me', requireAdmin, function (req, res) {
  res.json({ user: req.user });
});

// ── Profile helpers ─────────────────────────────────────────────────────────

function fallbackProfile(req) {
  return {
    id: req.user.id, email: req.user.email,
    full_name: req.user.name, mobile: req.user.mobile,
    avatar_url: null, birthdate: '',
    created_at: new Date().toISOString()
  };
}

// GET /api/auth/profile
router.get('/profile', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      var profile = store.raw.profiles.find(function (p) { return p.id === req.user.id; });
      return res.json({ profile: profile || fallbackProfile(req) });
    }
    var { data, error } = await req.supabase.from('profiles').select('*').eq('id', req.user.id).maybeSingle();
    if (error) {
      console.warn('[auth/profile] read error:', error.message);
      return res.json({ profile: fallbackProfile(req) });
    }
    res.json({ profile: data || fallbackProfile(req) });
  } catch (e) { next(e); }
});

// PUT /api/auth/profile
router.put('/profile', getUser, requireUser, async (req, res, next) => {
  try {
    var { full_name, birthdate } = req.body || {};
    if (MODE === 'local') {
      var profile = store.raw.profiles.find(function (p) { return p.id === req.user.id; });
      if (profile) {
        if (full_name !== undefined) profile.full_name = full_name;
        if (birthdate !== undefined) profile.birthdate = birthdate;
        store.persist();
      }
      return res.json({ ok: true });
    }
    var updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (birthdate !== undefined) updates.birthdate = birthdate;
    var { data, error } = await req.supabase.from('profiles').update(updates).eq('id', req.user.id).select();
    if (error) return res.status(400).json({ error: 'Could not save profile: ' + error.message });
    if (!data || data.length === 0) {
      return res.status(403).json({ error: 'Profile could not be updated (database rejected the write — check RLS policies). See src/db/fix-profiles-rls.sql.' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/auth/profile/avatar
router.put('/profile/avatar', getUser, requireUser, async (req, res, next) => {
  try {
    var { avatar_url } = req.body || {};
    if (!avatar_url) return res.status(400).json({ error: 'Avatar URL is required.' });
    if (MODE === 'local') {
      var profile = store.raw.profiles.find(function (p) { return p.id === req.user.id; });
      if (profile) { profile.avatar_url = avatar_url; store.persist(); }
      return res.json({ ok: true });
    }
    var { data, error } = await req.supabase.from('profiles').update({ avatar_url: avatar_url }).eq('id', req.user.id).select();
    if (error) return res.status(400).json({ error: 'Could not save avatar: ' + error.message });
    if (!data || data.length === 0) {
      return res.status(403).json({ error: 'Avatar could not be saved (database rejected the write — check RLS policies). See src/db/fix-profiles-rls.sql.' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/auth/profile/password
router.put('/profile/password', getUser, requireUser, async (req, res, next) => {
  try {
    var { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords are required.' });
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    if (MODE === 'local') {
      var user = store.raw.users.find(function (u) { return u.id === req.user.id; });
      if (!user || user.password !== store.hash(current_password)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      user.password = store.hash(new_password);
      store.persist();
      return res.json({ ok: true });
    }
    var { error } = await supabase.auth.updateUser({ password: new_password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
