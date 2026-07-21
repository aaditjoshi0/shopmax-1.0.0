const { MODE, supabase, getAuthedClient } = require('../../config/supabase');
const store = require('../db/localStore');

function getUser(req, res, next) {
  req.user = null;
  try {
    const token = req.signedCookies && req.signedCookies.sm_session;
    if (token && typeof token === 'object' && token.id) {
      req.user = {
        id: token.id,
        email: token.email,
        name: token.name,
        mobile: token.mobile,
        role: token.role || 'customer'
      };
      if (MODE === 'supabase' && token.access_token) {
        req.supabase = getAuthedClient(token.access_token);
      }
    }
  } catch (_) {}
  if (!req.supabase) req.supabase = supabase;
  next();
}

function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'You must be logged in.' });
  }
  next();
}

async function fetchUserRole(userId) {
  try {
    if (MODE === 'local') {
      const profile = store.raw.profiles.find(p => p.id === userId);
      return (profile && profile.role) || 'customer';
    }
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    return (data && data.role) || 'customer';
  } catch (_) {
    return 'customer';
  }
}

function requireAdmin(req, res, next) {
  const adminToken = req.signedCookies && req.signedCookies.sm_admin_session;
  if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin') {
    req.user = {
      id: adminToken.id,
      email: adminToken.email,
      name: adminToken.name,
      mobile: adminToken.mobile,
      role: adminToken.role || 'admin'
    };
    if (MODE === 'supabase' && adminToken.access_token) {
      req.supabase = getAuthedClient(adminToken.access_token);
    }
    return next();
  }
  if (!req.user) {
    return res.status(401).json({ error: 'You must be logged in.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { getUser, requireUser, requireAdmin, fetchUserRole };
