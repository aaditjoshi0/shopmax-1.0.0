const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser, fetchUserRole } = require('../middleware/auth');

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

// After successful login/signup, merge any existing guest cart into the user cart.
// Guest cart is stored in localStore (JSON file) for both local and supabase modes.
async function mergeGuestCart(req, res, userId) {
  const guestCookie = req.signedCookies && req.signedCookies.sm_guest;
  if (!guestCookie) return;

  try {
    // Find guest cart in localStore (guests always use localStore regardless of mode)
    const guestCart = store.raw.carts.find(c => c.owner === 'guest:' + guestCookie);
    const guestCartAlt = store.raw.carts.find(c => c.owner === guestCookie);
    const source = (guestCart && guestCart.items.length) ? guestCart : (guestCartAlt || { items: [] });

    if (!source.items || source.items.length === 0) return;

    if (MODE === 'local') {
      const userCart = store.raw.carts.find(c => c.owner === 'user:' + userId);
      if (userCart) {
        for (const gItem of source.items) {
          const match = userCart.items.find(i =>
            (gItem.product_id && i.product_id === gItem.product_id && (i.size || null) === (gItem.size || null) && (i.color || '') === (gItem.color || ''))
          );
          if (match) match.quantity += gItem.quantity;
          else userCart.items.push({ ...gItem });
        }
      } else {
        store.raw.carts.push({ id: store.uid(), owner: 'user:' + userId, items: source.items.map(i => ({ ...i })) });
      }
      store.raw.carts = store.raw.carts.filter(c => c.owner !== 'guest:' + guestCookie && c.owner !== guestCookie);
      store.persist();
      res.clearCookie('sm_guest');
      return;
    }

    // Supabase mode — merge localStore guest items into Supabase user cart
    const { data: existingUserCart } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    let userCartId;
    if (existingUserCart) {
      userCartId = existingUserCart.id;
    } else {
      const { data: newCart, error: cErr } = await supabase
        .from('carts')
        .insert({ user_id: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select('id')
        .single();
      if (cErr) throw new Error('Failed to create user cart: ' + cErr.message);
      userCartId = newCart.id;
    }

    for (const gItem of source.items) {
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', userCartId)
        .eq('product_id', gItem.product_id)
        .eq('size', gItem.size || '')
        .eq('color', gItem.color || '')
        .maybeSingle();

      if (existing) {
        await supabase.from('cart_items').update({ quantity: existing.quantity + gItem.quantity }).eq('id', existing.id);
      } else {
        await supabase.from('cart_items').insert({
          cart_id: userCartId,
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
    await supabase.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', userCartId);
    res.clearCookie('sm_guest');
  } catch (_) {
    // Merge is best-effort — never block login for a cart merge failure
  }
}

function setSession(res, user) {
  res.cookie('sm_session', {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    role: user.role || 'customer'
  }, {
    signed: true,
    httpOnly: true,
    maxAge: ONE_WEEK,
    sameSite: 'lax'
  });
}

// Auto-add missing columns to profiles table (runs once on startup)
if (MODE === 'supabase' && supabase) {
  (async () => {
    try {
      await supabase.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mobile text;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthdate text;' }).catch(() => {});
      await supabase.rpc('exec_sql', { sql: "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text not null default 'customer';" }).catch(() => {});
    } catch (_) {}
  })();
}

// signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, full_name, mobile, birthdate } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (!mobile) return res.status(400).json({ error: 'Mobile number is required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    if (MODE === 'local') {
      const exists = store.raw.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });
      const mobileExists = store.raw.users.find(u => u.mobile === mobile);
      if (mobileExists) return res.status(409).json({ error: 'An account with that mobile number already exists.' });
      const id = 'local-' + store.uid();
      const user = { id, email, full_name: full_name || '', mobile, birthdate: birthdate || '', password: store.hash(password), role: 'customer', created_at: new Date().toISOString() };
      store.raw.users.push(user);
      store.raw.profiles.push({ id, email, full_name: full_name || '', mobile, birthdate: birthdate || '', avatar_url: null, role: 'customer', created_at: user.created_at });
      store.persist();
      const session = { id, email, name: full_name || email, mobile, role: 'customer' };
      setSession(res, session);
      await mergeGuestCart(req, res, id);
      return res.json({ user: session });
    }

    // Supabase mode
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: full_name || '', mobile: mobile || '', birthdate: birthdate || '' } }
    });
    if (error) return res.status(400).json({ error: error.message });
    const u = data.user;
    if (!u) return res.json({ user: null, message: 'Check your email to confirm your account.' });

    // Upsert profile with mobile + birthdate + role
    await supabase.from('profiles').upsert({
      id: u.id, email: u.email, full_name: full_name || '', mobile: mobile || '', birthdate: birthdate || '', role: 'customer'
    }, { onConflict: 'id' });

    const session = { id: u.id, email: u.email, name: full_name || u.email, mobile: mobile || '', role: 'customer' };
    setSession(res, session);
    await mergeGuestCart(req, res, u.id);
    res.json({ user: session });
  } catch (e) { next(e); }
});

// login
router.post('/login', async (req, res, next) => {
  try {
    const { email, mobile, password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required.' });
    if (!email && !mobile) return res.status(400).json({ error: 'Email or mobile number is required.' });

    if (MODE === 'local') {
      const user = email
        ? store.raw.users.find(u => u.email.toLowerCase() === email.toLowerCase())
        : store.raw.users.find(u => u.mobile === mobile);
      if (!user || user.password !== store.hash(password)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const userProfile = store.raw.profiles.find(p => p.id === user.id);
      const role = (userProfile && userProfile.role) || 'customer';
      const session = { id: user.id, email: user.email, name: user.full_name || user.email, mobile: user.mobile, role };
      setSession(res, session);
      await mergeGuestCart(req, res, user.id);
      return res.json({ user: session });
    }

    // Supabase mode — mobile login requires looking up email by mobile first
    let loginEmail = email;
    if (!loginEmail && mobile) {
      const { data: profile } = await supabase.from('profiles').select('email').eq('mobile', mobile).single();
      if (!profile || !profile.email) {
        return res.status(401).json({ error: 'No account found with that mobile number.' });
      }
      loginEmail = profile.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) return res.status(401).json({ error: error.message });
    const u = data.user;
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
    const role = (profile && profile.role) || 'customer';
    const session = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email, mobile: mobile || (u.user_metadata && u.user_metadata.mobile) || '', role };
    setSession(res, session);
    await mergeGuestCart(req, res, u.id);
    res.json({ user: session });
  } catch (e) { next(e); }
});

// logout
router.post('/logout', (req, res) => {
  res.clearCookie('sm_session');
  res.json({ ok: true });
});

// ---------- Admin-specific auth (separate cookie from user website) ----------

function setAdminSession(res, user) {
  res.cookie('sm_admin_session', {
    id: user.id,
    email: user.email,
    name: user.name,
    mobile: user.mobile,
    role: user.role || 'admin'
  }, {
    signed: true,
    httpOnly: true,
    maxAge: ONE_WEEK,
    sameSite: 'lax'
  });
}

// POST /api/auth/admin-login — admin login (sets sm_admin_session cookie)
router.post('/admin-login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    if (MODE === 'local') {
      const user = store.raw.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user || user.password !== store.hash(password)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const userProfile = store.raw.profiles.find(p => p.id === user.id);
      const role = (userProfile && userProfile.role) || 'customer';
      if (role !== 'admin') return res.status(403).json({ error: 'This account does not have admin access.' });
      const session = { id: user.id, email: user.email, name: user.full_name || user.email, mobile: user.mobile, role };
      setAdminSession(res, session);
      return res.json({ user: session });
    }

    // Supabase mode
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    const u = data.user;
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
    const role = (profile && profile.role) || 'customer';
    if (role !== 'admin') return res.status(403).json({ error: 'This account does not have admin access.' });
    const session = { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email, mobile: (u.user_metadata && u.user_metadata.mobile) || '', role };
    setAdminSession(res, session);
    res.json({ user: session });
  } catch (e) { next(e); }
});

// POST /api/auth/admin-logout — admin logout (clears sm_admin_session cookie)
router.post('/admin-logout', (req, res) => {
  res.clearCookie('sm_admin_session');
  res.json({ ok: true });
});

// me
router.get('/me', getUser, (req, res) => {
  res.json({ user: req.user });
});

// Fallback profile used when no row exists (or RLS hides it from the anon client).
function fallbackProfile(req) {
  return {
    id: req.user.id, email: req.user.email,
    full_name: req.user.name, mobile: req.user.mobile,
    avatar_url: null, birthdate: '',
    created_at: new Date().toISOString()
  };
}

// get full profile
router.get('/profile', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const profile = store.raw.profiles.find(p => p.id === req.user.id);
      return res.json({ profile: profile || fallbackProfile(req) });
    }
    // .maybeSingle() returns null instead of throwing when 0 rows match
    // (which is what happens if RLS blocks the read with the anon client).
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).maybeSingle();
    if (error) {
      console.warn('[auth/profile] read error:', error.message);
      return res.json({ profile: fallbackProfile(req) });
    }
    res.json({ profile: data || fallbackProfile(req) });
  } catch (e) { next(e); }
});

// update profile
router.put('/profile', getUser, requireUser, async (req, res, next) => {
  try {
    const { full_name, birthdate } = req.body || {};
    if (MODE === 'local') {
      const profile = store.raw.profiles.find(p => p.id === req.user.id);
      if (profile) {
        if (full_name !== undefined) profile.full_name = full_name;
        if (birthdate !== undefined) profile.birthdate = birthdate;
        store.persist();
      }
      return res.json({ ok: true });
    }
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (birthdate !== undefined) updates.birthdate = birthdate;
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', req.user.id).select();
    if (error) return res.status(400).json({ error: 'Could not save profile: ' + error.message });
    // RLS can silently make the update match 0 rows (returns null/empty).
    // Surface that as an error instead of pretending it succeeded.
    if (!data || data.length === 0) {
      return res.status(403).json({ error: 'Profile could not be updated (database rejected the write — check RLS policies). See src/db/fix-profiles-rls.sql.' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// update avatar
router.put('/profile/avatar', getUser, requireUser, async (req, res, next) => {
  try {
    const { avatar_url } = req.body || {};
    if (!avatar_url) return res.status(400).json({ error: 'Avatar URL is required.' });
    if (MODE === 'local') {
      const profile = store.raw.profiles.find(p => p.id === req.user.id);
      if (profile) { profile.avatar_url = avatar_url; store.persist(); }
      return res.json({ ok: true });
    }
    const { data, error } = await supabase.from('profiles').update({ avatar_url }).eq('id', req.user.id).select();
    if (error) return res.status(400).json({ error: 'Could not save avatar: ' + error.message });
    // If RLS blocked the update, 0 rows come back — tell the client instead of
    // silently reporting success (which is what caused the "black box after refresh").
    if (!data || data.length === 0) {
      return res.status(403).json({ error: 'Avatar could not be saved (database rejected the write — check RLS policies). See src/db/fix-profiles-rls.sql.' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// change password
router.put('/profile/password', getUser, requireUser, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords are required.' });
    if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    if (MODE === 'local') {
      const user = store.raw.users.find(u => u.id === req.user.id);
      if (!user || user.password !== store.hash(current_password)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      user.password = store.hash(new_password);
      store.persist();
      return res.json({ ok: true });
    }
    const { error } = await supabase.auth.updateUser({ password: new_password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
