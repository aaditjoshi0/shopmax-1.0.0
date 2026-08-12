const { MODE, supabase, getAuthedClient } = require('../../config/supabase');
const store = require('../db/localStore');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Local mode mints ids like "local-a1b2c3…"; Supabase uses auth.users UUIDs.
// A cookie therefore outlives a mode switch and, left alone, gets handed to
// Postgres as a uuid — every authenticated query then 500s ("invalid input
// syntax for type uuid"). Treat a mismatched cookie as simply logged out.
function idMatchesMode(id) {
  if (!id) return false;
  return MODE === 'supabase' ? UUID_RE.test(id) : !UUID_RE.test(id);
}

function dropStaleSession(res, cookieName) {
  try { res.clearCookie(cookieName); } catch (_) {}
}

function getUser(req, res, next) {
  req.user = null;
  try {
    // Admin session takes priority
    const adminToken = req.signedCookies && req.signedCookies.sm_admin_session;
    if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin'
        && !idMatchesMode(adminToken.id)) {
      dropStaleSession(res, 'sm_admin_session');
    } else if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin') {
      req.user = {
        id: adminToken.id,
        email: adminToken.email,
        name: adminToken.name,
        mobile: adminToken.mobile,
        role: 'admin'
      };
      if (MODE === 'supabase' && adminToken.access_token) {
        req.supabase = getAuthedClient(adminToken.access_token);

        // Verify the admin access token is still valid with a lightweight probe.
        var probeTimer = null;
        var done = false;
        function finish(err) {
          if (done) return;
          done = true;
          if (probeTimer) clearTimeout(probeTimer);
          if (err) {
            if (!res.headersSent) {
              res.clearCookie('sm_admin_session');
              res.status(401).json({ error: 'Admin session expired. Please login again.' });
            }
          } else {
            next();
          }
        }

        probeTimer = setTimeout(function () {
          finish(null);
        }, 5000);

        req.supabase.from('profiles').select('id').eq('id', adminToken.id).limit(1)
          .then(function (result) {
            if (done) return;
            if (result && !result.error) {
              finish(null);
              return;
            }
            supabase.auth.refreshSession({ refresh_token: adminToken.refresh_token })
              .then(function (_a) {
                if (done) return;
                var error = _a.error;
                var session = _a.data && _a.data.session;
                if (error || !session) {
                  finish(error || new Error('Failed to refresh admin session'));
                  return;
                }
                var newPayload = {
                  id: adminToken.id,
                  email: adminToken.email,
                  name: adminToken.name,
                  mobile: adminToken.mobile,
                  role: 'admin',
                  access_token: session.access_token,
                  refresh_token: session.refresh_token
                };
                res.cookie('sm_admin_session', newPayload, {
                  signed: true,
                  httpOnly: true,
                  maxAge: 7 * 24 * 60 * 60 * 1000,
                  sameSite: 'lax'
                });
                req.supabase = getAuthedClient(session.access_token);
                finish(null);
              })
              .catch(function (refreshErr) {
                if (done) return;
                finish('Admin session expired. Please login again.');
              });
          })
          .catch(function () {
            if (done) return;
            finish(null);
          });

        return;
      }
      return next();
    }
    const token = req.signedCookies && req.signedCookies.sm_session;
    if (token && typeof token === 'object' && token.id && !idMatchesMode(token.id)) {
      dropStaleSession(res, 'sm_session');
    } else if (token && typeof token === 'object' && token.id) {
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
        // Add a timeout so the request never hangs if Supabase is unreachable.
        var probeTimer = null;
        var done = false;
        function finish(err) {
          if (done) return;
          done = true;
          if (probeTimer) clearTimeout(probeTimer);
          if (err) {
            if (!res.headersSent) {
              res.clearCookie('sm_session');
              res.status(401).json({ error: 'Session expired. Please login again.' });
            }
          } else {
            next();
          }
        }

        // Set a 5-second timeout — if Supabase doesn't respond, proceed anyway
        probeTimer = setTimeout(function () {
          console.warn('[auth] Supabase probe timed out — proceeding with cached user');
          finish(null);
        }, 5000);

        req.supabase.from('profiles').select('id').eq('id', token.id).limit(1)
          .then(function (result) {
            if (done) return;
            if (result && !result.error) {
              // Token is valid — proceed
              finish(null);
              return;
            }

            // Token invalid/expired — attempt refresh
            supabase.auth.refreshSession({ refresh_token: token.refresh_token })
              .then(function (_a) {
                if (done) return;
                var error = _a.error;
                var session = _a.data && _a.data.session;
                if (error || !session) {
                  finish(error || new Error('Failed to refresh session'));
                  return;
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
                finish(null);
              })
              .catch(function (refreshErr) {
                if (done) return;
                console.warn('[auth] token refresh failed:', refreshErr.message || refreshErr);
                finish('Session expired. Please login again.');
              });
          })
          .catch(function (probeErr) {
            if (done) return;
            console.warn('[auth] probe error:', probeErr.message || probeErr);
            finish('Session expired. Please login again.');
          });

        return;
      }
    }
  } catch (_) {}
  if (!req.supabase) req.supabase = supabase;
  next();
}

function requireUser(req, res, next) {
  // Admin session always takes priority over regular session
  const adminToken = req.signedCookies && req.signedCookies.sm_admin_session;
  if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin'
      && idMatchesMode(adminToken.id)) {
    req.user = {
      id: adminToken.id,
      email: adminToken.email,
      name: adminToken.name,
      mobile: adminToken.mobile,
      role: 'admin'
    };
    if (MODE === 'supabase' && adminToken.access_token) {
      req.supabase = getAuthedClient(adminToken.access_token);
    }
    return next();
  }
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
  if (adminToken && typeof adminToken === 'object' && adminToken.id && adminToken.role === 'admin'
      && idMatchesMode(adminToken.id)) {
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
