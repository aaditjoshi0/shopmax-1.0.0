// Auth middleware.
// Reads the signed "sm_session" cookie which holds a JSON token with { id, email, name, role }.
// In Supabase mode this token represents a verified Supabase user (set on login).
// In local mode it represents a row in the local users store.
// Attaches req.user = { id, email, name, mobile, role } or null.

const { MODE, supabase } = require('../../config/supabase');
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
    }
  } catch (_) { /* invalid cookie -> treated as anonymous */ }
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
  // Check admin-specific cookie first (sm_admin_session)
  const adminToken = req.signedCookies && req.signedCookies.sm_admin_session;
  if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin') {
    req.user = {
      id: adminToken.id,
      email: adminToken.email,
      name: adminToken.name,
      mobile: adminToken.mobile,
      role: adminToken.role || 'admin'
    };
    return next();
  }
  // Fallback to the user-scoped session (for backward compatibility)
  if (!req.user) {
    return res.status(401).json({ error: 'You must be logged in.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { getUser, requireUser, requireAdmin, fetchUserRole };
