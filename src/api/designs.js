// Designs API (customizer output).
//  GET    /api/designs            -> list current user's designs
//  POST   /api/designs            -> save { name, canvas_data, thumbnail_url, product_type }
//  DELETE /api/designs/:id        -> delete (owner only)

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser } = require('../middleware/auth');

// GET /api/designs
router.get('/', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const designs = store.raw.designs
      .filter(d => d.user_id === req.user.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(designs);
  } catch (e) { next(e); }
});

// POST /api/designs
router.post('/', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const { name, canvas_data, thumbnail_url, product_type } = req.body || {};
    if (!canvas_data) return res.status(400).json({ error: 'canvas_data is required' });
    const design = {
      id: store.nextId('design'),
      user_id: req.user.id,
      name: name || 'Untitled design',
      canvas_data,
      thumbnail_url: thumbnail_url || null,
      product_type: product_type || 'tshirt',
      created_at: new Date().toISOString()
    };
    store.raw.designs.push(design);
    store.persist();
    res.json({ design });
  } catch (e) { next(e); }
});

// DELETE /api/designs/:id
router.delete('/:id', getUser, requireUser, (req, res, next) => {
  try {
    if (MODE !== 'local') return next(new Error('Use local mode for this build.'));
    const id = Number(req.params.id);
    const before = store.raw.designs.length;
    store.raw.designs = store.raw.designs.filter(d => !(d.id === id && d.user_id === req.user.id));
    store.persist();
    res.json({ ok: store.raw.designs.length < before });
  } catch (e) { next(e); }
});

module.exports = router;
