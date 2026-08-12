// Community Marketplace API.
//
// A listing is a design a customer made in the customizer and chose to publish.
// Anyone can browse listings, like them, save them to a private wishlist, buy
// them as-is, or remix them (load the design back into the customizer).
//
//  GET    /api/marketplace                -> browse ?q=&category=&sort=&designer=&page=&limit=
//  GET    /api/marketplace/mine/list      -> listings I published
//  GET    /api/marketplace/saved/list     -> listings I saved (private wishlist)
//  GET    /api/marketplace/liked/list     -> listings I liked
//  GET    /api/marketplace/:id            -> single listing (+ increments views)
//  GET    /api/marketplace/:id/related    -> more from the same designer / category
//  POST   /api/marketplace                -> publish a listing
//  PATCH  /api/marketplace/:id            -> edit own listing
//  DELETE /api/marketplace/:id            -> delete own listing
//  POST   /api/marketplace/:id/like       -> like / unlike (toggle)
//  POST   /api/marketplace/:id/save       -> save / unsave (toggle)
//
// Works in BOTH local and supabase mode.

const express = require('express');
const router = express.Router();
const { supabase, MODE, getServiceClient } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser } = require('../middleware/auth');
const { restoreThumbnailFile } = require('../services/thumbnails');

const CATEGORIES = ['tshirt', 'hoodie', 'shirt', 'jacket', 'bottoms', 'accessory', 'other'];
const MAX_LIMIT = 60;

// Reads use the service client: the `profiles` RLS policy is owner-only, so an
// authed client cannot resolve another user's designer name, and anonymous
// browsing has no client at all.
function db(req) {
  return getServiceClient() || (req && req.supabase) || supabase;
}

// Every schema object this file needs but the base schema.sql does not create.
const MIGRATION_OBJECTS = /listing_likes|listing_saves|likes_count|saves_count|design_snapshot|base_product_id|\bviews\b|\btags\b/i;

function isMissingTable(error) {
  if (!error) return false;
  const msg = error.message || '';
  return /does not exist|schema cache/i.test(msg) && MIGRATION_OBJECTS.test(msg);
}

// The marketplace needs tables/columns that ship in src/db/marketplace.sql.
// Fail loudly and usefully rather than surfacing a Postgres error the user
// cannot act on.
function migrationError() {
  return Object.assign(
    new Error('Marketplace setup is incomplete — run src/db/marketplace.sql in the Supabase SQL editor.'),
    { status: 503 }
  );
}

// Every route funnels errors through here so a missing migration always reads
// the same, wherever it first surfaces.
function fail(next) {
  return function (e) {
    next(isMissingTable(e) ? migrationError() : e);
  };
}

// ---------------------------------------------------------------- shaping

function clampPage(q) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || 24));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  return { limit, page, from: (page - 1) * limit, to: page * limit - 1 };
}

function publicListing(l, extra) {
  return Object.assign({
    id: l.id,
    user_id: l.user_id,
    title: l.title,
    description: l.description || '',
    price: Number(l.price),
    image_url: l.image_url,
    size: l.size || null,
    color: l.color || '',
    category: l.category || 'other',
    tags: l.tags || [],
    design_id: l.design_id || null,
    base_product_id: l.base_product_id || null,
    status: l.status,
    likes_count: l.likes_count || 0,
    saves_count: l.saves_count || 0,
    views: l.views || 0,
    created_at: l.created_at,
    updated_at: l.updated_at || l.created_at
  }, extra || {});
}

// ---------------------------------------------------------------- local helpers

function localDesignerName(userId) {
  const p = store.raw.profiles.find(p => p.id === userId);
  if (p && p.full_name) return p.full_name;
  const u = store.raw.users.find(u => u.id === userId);
  return (u && u.full_name) || (u && u.email) || 'Anonymous';
}

function localDecorate(rows, userId) {
  rows.forEach(l => restoreThumbnailFile(l.image_url, l.design_snapshot));
  const likes = store.raw.listing_likes || [];
  const saves = store.raw.listing_saves || [];
  return rows.map(l => publicListing(l, {
    designer_name: localDesignerName(l.user_id),
    liked: !!userId && likes.some(x => x.listing_id === l.id && x.user_id === userId),
    saved: !!userId && saves.some(x => x.listing_id === l.id && x.user_id === userId),
    is_mine: !!userId && l.user_id === userId
  }));
}

function localSort(items, sort) {
  switch (sort) {
    case 'price-asc':  return items.sort((a, b) => a.price - b.price);
    case 'price-desc': return items.sort((a, b) => b.price - a.price);
    case 'popular':    return items.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0) ||
                                                   new Date(b.created_at) - new Date(a.created_at));
    default:           return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

// ---------------------------------------------------------------- supabase helpers

// Resolve designer names for a page of listings in ONE query instead of per row.
async function attachNames(req, rows) {
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await db(req).from('profiles').select('id, full_name, email').in('id', ids);
  const map = {};
  (data || []).forEach(p => { map[p.id] = p.full_name || p.email || 'Anonymous'; });
  return map;
}

// Which of these listings has the current user liked / saved? Two queries total.
async function attachFlags(req, rows, userId) {
  if (!userId || !rows.length) return { liked: {}, saved: {} };
  const ids = rows.map(r => r.id);
  const [likeRes, saveRes] = await Promise.all([
    db(req).from('listing_likes').select('listing_id').eq('user_id', userId).in('listing_id', ids),
    db(req).from('listing_saves').select('listing_id').eq('user_id', userId).in('listing_id', ids)
  ]);
  if (isMissingTable(likeRes.error) || isMissingTable(saveRes.error)) throw migrationError();
  const liked = {}, saved = {};
  (likeRes.data || []).forEach(r => { liked[r.listing_id] = true; });
  (saveRes.data || []).forEach(r => { saved[r.listing_id] = true; });
  return { liked, saved };
}

async function decorate(req, rows, userId) {
  rows.forEach(l => restoreThumbnailFile(l.image_url, l.design_snapshot));
  const [names, flags] = await Promise.all([attachNames(req, rows), attachFlags(req, rows, userId)]);
  return rows.map(l => publicListing(l, {
    designer_name: names[l.user_id] || 'Anonymous',
    liked: !!flags.liked[l.id],
    saved: !!flags.saved[l.id],
    is_mine: !!userId && l.user_id === userId
  }));
}

function applySort(query, sort) {
  switch (sort) {
    case 'price-asc':  return query.order('price', { ascending: true });
    case 'price-desc': return query.order('price', { ascending: false });
    case 'popular':    return query.order('likes_count', { ascending: false }).order('created_at', { ascending: false });
    default:           return query.order('created_at', { ascending: false });
  }
}

// ---------------------------------------------------------------- browse

// GET /api/marketplace
router.get('/', getUser, async (req, res, next) => {
  try {
    const { q, category, sort, designer } = req.query;
    const { limit, page, from, to } = clampPage(req.query);
    const userId = req.user && req.user.id;

    if (MODE === 'local') {
      let items = (store.raw.listings || []).filter(l => l.status === 'active');
      if (category) items = items.filter(l => l.category === category);
      if (designer) items = items.filter(l => l.user_id === designer);
      if (q) {
        const needle = String(q).toLowerCase();
        items = items.filter(l =>
          (l.title || '').toLowerCase().includes(needle) ||
          (l.description || '').toLowerCase().includes(needle) ||
          (l.tags || []).some(t => String(t).toLowerCase().includes(needle))
        );
      }
      const total = items.length;
      const pageItems = localSort(items, sort).slice(from, from + limit);
      return res.json({ items: localDecorate(pageItems, userId), total, page, limit });
    }

    let query = db(req).from('listings').select('*', { count: 'exact' }).eq('status', 'active');
    if (category) query = query.eq('category', category);
    if (designer) query = query.eq('user_id', designer);
    if (q) {
      const needle = String(q).replace(/[%,()]/g, ' ');
      query = query.or('title.ilike.%' + needle + '%,description.ilike.%' + needle + '%');
    }
    const { data, error, count } = await applySort(query, sort).range(from, to);
    if (error) throw error;
    res.json({ items: await decorate(req, data || [], userId), total: count || 0, page, limit });
  } catch (e) { fail(next)(e); }
});

// GET /api/marketplace/mine/list
router.get('/mine/list', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const mine = (store.raw.listings || []).filter(l => l.user_id === req.user.id);
      return res.json({ items: localDecorate(localSort(mine, 'latest'), req.user.id) });
    }
    const { data, error } = await db(req).from('listings').select('*')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ items: await decorate(req, data || [], req.user.id) });
  } catch (e) { fail(next)(e); }
});

// GET /api/marketplace/saved/list — the private wishlist
router.get('/saved/list', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const savedIds = (store.raw.listing_saves || [])
        .filter(s => s.user_id === req.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(s => s.listing_id);
      const byId = {};
      (store.raw.listings || []).forEach(l => { byId[l.id] = l; });
      const items = savedIds.map(id => byId[id]).filter(l => l && l.status === 'active');
      return res.json({ items: localDecorate(items, req.user.id) });
    }
    const { data, error } = await db(req).from('listing_saves')
      .select('created_at, listings(*)')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (isMissingTable(error)) throw migrationError();
    if (error) throw error;
    const rows = (data || []).map(r => r.listings).filter(l => l && l.status === 'active');
    res.json({ items: await decorate(req, rows, req.user.id) });
  } catch (e) { fail(next)(e); }
});

// GET /api/marketplace/liked/list
router.get('/liked/list', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const likedIds = (store.raw.listing_likes || [])
        .filter(s => s.user_id === req.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(s => s.listing_id);
      const byId = {};
      (store.raw.listings || []).forEach(l => { byId[l.id] = l; });
      const items = likedIds.map(id => byId[id]).filter(l => l && l.status === 'active');
      return res.json({ items: localDecorate(items, req.user.id) });
    }
    const { data, error } = await db(req).from('listing_likes')
      .select('created_at, listings(*)')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (isMissingTable(error)) throw migrationError();
    if (error) throw error;
    const rows = (data || []).map(r => r.listings).filter(l => l && l.status === 'active');
    res.json({ items: await decorate(req, rows, req.user.id) });
  } catch (e) { fail(next)(e); }
});

// ---------------------------------------------------------------- single

// GET /api/marketplace/:id
router.get('/:id', getUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(404).json({ error: 'Listing not found' });
    const userId = req.user && req.user.id;

    if (MODE === 'local') {
      const l = (store.raw.listings || []).find(x => x.id === id);
      if (!l || (l.status !== 'active' && l.user_id !== userId)) {
        return res.status(404).json({ error: 'Listing not found' });
      }
      l.views = (l.views || 0) + 1;
      store.persist();
      const design = l.design_id ? (store.raw.designs || []).find(d => d.id === l.design_id) : null;
      const out = localDecorate([l], userId)[0];
      return res.json(Object.assign(out, { design_snapshot: l.design_snapshot || (design && design.canvas_data) || null }));
    }

    const { data, error } = await db(req).from('listings').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || (data.status !== 'active' && data.user_id !== userId)) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    // Fire-and-forget: a failed view bump must never break the page.
    db(req).from('listings').update({ views: (data.views || 0) + 1 }).eq('id', id)
      .then(function () {}, function () {});

    const out = (await decorate(req, [data], userId))[0];
    res.json(Object.assign(out, { design_snapshot: data.design_snapshot || null }));
  } catch (e) { fail(next)(e); }
});

// GET /api/marketplace/:id/related
router.get('/:id/related', getUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user && req.user.id;

    if (MODE === 'local') {
      const l = (store.raw.listings || []).find(x => x.id === id);
      if (!l) return res.json({ items: [] });
      const pool = (store.raw.listings || []).filter(x => x.status === 'active' && x.id !== id);
      const same = pool.filter(x => x.user_id === l.user_id || x.category === l.category);
      return res.json({ items: localDecorate(localSort(same, 'popular').slice(0, 4), userId) });
    }

    const { data: l } = await db(req).from('listings').select('user_id, category').eq('id', id).maybeSingle();
    if (!l) return res.json({ items: [] });
    const { data, error } = await db(req).from('listings').select('*')
      .eq('status', 'active').neq('id', id)
      .or('user_id.eq.' + l.user_id + ',category.eq.' + l.category)
      .order('likes_count', { ascending: false }).limit(4);
    if (error) throw error;
    res.json({ items: await decorate(req, data || [], userId) });
  } catch (e) { fail(next)(e); }
});

// ---------------------------------------------------------------- publish / edit / delete

function readListingBody(b) {
  const title = String(b.title || '').trim();
  const price = Number(b.price);
  const errors = [];
  if (!title) errors.push('A title is required.');
  if (title.length > 80) errors.push('Title must be 80 characters or fewer.');
  if (!b.image_url) errors.push('A preview image is required.');
  if (!isFinite(price) || price <= 0) errors.push('Enter a price greater than 0.');
  if (price > 100000) errors.push('Price looks too high.');
  if (b.category && CATEGORIES.indexOf(b.category) === -1) errors.push('Unknown category.');
  return { title, price, errors };
}

// POST /api/marketplace
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { title, price, errors } = readListingBody(b);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const tags = Array.isArray(b.tags)
      ? b.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [];

    const row = {
      user_id: req.user.id,
      title,
      description: String(b.description || '').slice(0, 2000),
      price,
      image_url: b.image_url,
      size: b.size || null,
      color: b.color || '',
      category: b.category || 'other',
      tags,
      design_id: b.design_id || null,
      base_product_id: b.base_product_id || null,
      design_snapshot: b.design_snapshot || null,
      status: 'active'
    };

    if (MODE === 'local') {
      const listing = Object.assign({
        id: store.nextId('listing'),
        likes_count: 0,
        saves_count: 0,
        views: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, row);
      store.raw.listings.push(listing);
      store.persist();
      return res.json({ listing: localDecorate([listing], req.user.id)[0] });
    }

    const { data, error } = await db(req).from('listings').insert(row).select('*').single();
    if (error) throw error;
    res.json({ listing: (await decorate(req, [data], req.user.id))[0] });
  } catch (e) { fail(next)(e); }
});

// PATCH /api/marketplace/:id
router.patch('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const patch = {};
    if (b.title != null) patch.title = String(b.title).trim().slice(0, 80);
    if (b.description != null) patch.description = String(b.description).slice(0, 2000);
    if (b.price != null) {
      const price = Number(b.price);
      if (!isFinite(price) || price <= 0) return res.status(400).json({ error: 'Enter a price greater than 0.' });
      patch.price = price;
    }
    if (b.category != null) {
      if (CATEGORIES.indexOf(b.category) === -1) return res.status(400).json({ error: 'Unknown category.' });
      patch.category = b.category;
    }
    if (b.status != null) {
      if (['active', 'hidden'].indexOf(b.status) === -1) return res.status(400).json({ error: 'Unknown status.' });
      patch.status = b.status;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });
    patch.updated_at = new Date().toISOString();

    if (MODE === 'local') {
      const l = (store.raw.listings || []).find(x => x.id === id && x.user_id === req.user.id);
      if (!l) return res.status(404).json({ error: 'Listing not found' });
      Object.assign(l, patch);
      store.persist();
      return res.json({ listing: localDecorate([l], req.user.id)[0] });
    }

    const { data, error } = await db(req).from('listings').update(patch)
      .eq('id', id).eq('user_id', req.user.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    res.json({ listing: (await decorate(req, [data], req.user.id))[0] });
  } catch (e) { fail(next)(e); }
});

// DELETE /api/marketplace/:id
router.delete('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (MODE === 'local') {
      const before = store.raw.listings.length;
      store.raw.listings = store.raw.listings.filter(l => !(l.id === id && l.user_id === req.user.id));
      store.raw.listing_likes = (store.raw.listing_likes || []).filter(x => x.listing_id !== id);
      store.raw.listing_saves = (store.raw.listing_saves || []).filter(x => x.listing_id !== id);
      store.persist();
      return res.json({ ok: store.raw.listings.length < before });
    }

    const { error } = await db(req).from('listings').delete().eq('id', id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(next)(e); }
});

// ---------------------------------------------------------------- like / save

// Both endpoints toggle, so the client only needs one call per tap and can't
// desync by double-firing.
function toggleRoute(kind) {
  const table = kind === 'like' ? 'listing_likes' : 'listing_saves';
  const bucket = kind === 'like' ? 'listing_likes' : 'listing_saves';
  const counter = kind === 'like' ? 'likes_count' : 'saves_count';
  const counterName = kind === 'like' ? 'listing_like' : 'listing_save';

  return async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const userId = req.user.id;

      if (MODE === 'local') {
        const listing = (store.raw.listings || []).find(l => l.id === id);
        if (!listing) return res.status(404).json({ error: 'Listing not found' });
        store.raw[bucket] = store.raw[bucket] || [];
        const idx = store.raw[bucket].findIndex(x => x.listing_id === id && x.user_id === userId);
        let on;
        if (idx === -1) {
          store.raw[bucket].push({
            id: store.nextId(counterName),
            listing_id: id,
            user_id: userId,
            created_at: new Date().toISOString()
          });
          on = true;
        } else {
          store.raw[bucket].splice(idx, 1);
          on = false;
        }
        listing[counter] = store.raw[bucket].filter(x => x.listing_id === id).length;
        store.persist();
        return res.json({ ok: true, on, count: listing[counter] });
      }

      const sb = db(req);
      const { data: existing, error: findErr } = await sb.from(table).select('id')
        .eq('listing_id', id).eq('user_id', userId).maybeSingle();
      if (isMissingTable(findErr)) throw migrationError();
      if (findErr) throw findErr;

      let on;
      if (existing) {
        const { error } = await sb.from(table).delete().eq('id', existing.id);
        if (error) throw error;
        on = false;
      } else {
        const { error } = await sb.from(table).insert({ listing_id: id, user_id: userId });
        // 23503 = the listing does not exist; 23505 = raced with another tap.
        if (error && error.code === '23503') return res.status(404).json({ error: 'Listing not found' });
        if (error && error.code !== '23505') throw error;
        on = true;
      }

      const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('listing_id', id);
      res.json({ ok: true, on, count: count || 0 });
    } catch (e) { fail(next)(e); }
  };
}

router.post('/:id/like', getUser, requireUser, toggleRoute('like'));
router.post('/:id/save', getUser, requireUser, toggleRoute('save'));

module.exports = router;
