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

        // Verify the access token is still valid with a lightweight probe.
        // If Supabase rejects it (JWT expired), attempt a silent refresh using
        // the refresh_token stored in the same cookie.  On success the cookie
        // is updated with fresh tokens and req.supabase is recreated.  On
        // failure the session is cleared and the user is asked to re-login.
        req.supabase.from('profiles').select('id').eq('id', token.id).limit(1)
          .then(function (result) {
            if (res.headersSent) return;
            if (!result.error) return next(); // token valid — continue

            // Token invalid/expired — attempt refresh
            return supabase.auth.refreshSession({ refresh_token: token.refresh_token })
              .then(function (_a) {
                if (res.headersSent) return;
                var error = _a.error;
                var session = _a.data && _a.data.session;
                if (error || !session) {
                  res.clearCookie('sm_session');
                  return res.status(401).json({ error: 'Session expired. Please login again.' });
                }

                var newPayload = {
                  id: token.id,
                  email: token.email,
                  name: token.name,
                  mobile: token.mobile,
                  role: token.role || 'customer',
                  access_token: session.access_token,
                  refresh_token: session.refresh_token
                };
                res.cookie('sm_session', newPayload, {
                  signed: true,
                  httpOnly: true,
                  maxAge: 7 * 24 * 60 * 60 * 1000,
                  sameSite: 'lax'
                });
                req.supabase = getAuthedClient(session.access_token);
                return next();
              });
          })
          .catch(function () {
            if (res.headersSent) return;
            res.clearCookie('sm_session');
            return res.status(401).json({ error: 'Session expired. Please login again.' });
          });
        return; // async path — do not call next() here
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
