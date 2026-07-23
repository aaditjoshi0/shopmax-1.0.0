// Community marketplace API.
//  GET    /api/marketplace              -> list active listings ?category=&sort=&q=
//  GET    /api/marketplace/:id          -> single listing
//  POST   /api/marketplace              -> create listing (owner) { title, description, price, image_url, size?, category?, design_id? }
//  GET    /api/marketplace/mine/list    -> current user's listings
//  DELETE /api/marketplace/:id          -> delete (owner only)

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser } = require('../middleware/auth');

function designerName(userId) {
  const p = store.raw.profiles.find(p => p.id === userId);
  if (p && p.full_name) return p.full_name;
  const u = store.raw.users.find(u => u.id === userId);
  return (u && u.full_name) || (u && u.email) || 'Anonymous';
}

// GET /api/marketplace/mine/list
router.get('/mine/list', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const mine = store.raw.listings
      .filter(l => l.user_id === req.user.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(mine);
  } catch (e) { next(e); }
});

// GET /api/marketplace
router.get('/', async (req, res, next) => {
  try {
    const { category, sort, q } = req.query;
    let items = store.raw.listings.filter(l => l.status === 'active');
    if (category) items = items.filter(l => l.category === category);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter(l =>
        l.title.toLowerCase().includes(needle) ||
        (l.description || '').toLowerCase().includes(needle)
      );
    }
    switch (sort) {
      case 'price-asc':  items.sort((a, b) => a.price - b.price); break;
      case 'price-desc': items.sort((a, b) => b.price - a.price); break;
      default:           items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    // attach designer name
    items = items.map(function (l) {
      l.rating_count = l.rating_count || 0;
      return { ...l, designer_name: designerName(l.user_id) };
    });
    res.json(items);
  } catch (e) { next(e); }
});

// GET /api/marketplace/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const l = store.raw.listings.find(x => x.id === id);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    l.rating_count = l.rating_count || 0;
    res.json({ ...l, designer_name: designerName(l.user_id) });
  } catch (e) { next(e); }
});

// POST /api/marketplace
router.post('/', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const { title, description, price, image_url, size, category, design_id } = req.body || {};
    if (!title || price == null || !image_url) {
      return res.status(400).json({ error: 'title, price and image_url are required' });
    }
    const listing = {
      id: store.nextId('listing'),
      user_id: req.user.id,
      title,
      description: description || '',
      price: Number(price),
      image_url,
      size: size || null,
      category: category || (design_id ? 'design' : 'physical'),
      design_id: design_id || null,
      status: 'active',
      rating: 0,
      rating_count: 0,
      created_at: new Date().toISOString()
    };
    store.raw.listings.push(listing);
    store.persist();
    res.json({ listing });
  } catch (e) { next(e); }
});

// DELETE /api/marketplace/:id
router.delete('/:id', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const id = Number(req.params.id);
    const before = store.raw.listings.length;
    store.raw.listings = store.raw.listings.filter(l => !(l.id === id && l.user_id === req.user.id));
    store.persist();
    res.json({ ok: store.raw.listings.length < before });
  } catch (e) { next(e); }
});

module.exports = router;
