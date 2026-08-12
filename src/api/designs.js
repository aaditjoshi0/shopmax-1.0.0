// Designs API (customizer output).
//
//  GET    /api/designs            -> list current user's designs
//  GET    /api/designs/:id        -> single design (own, or one published to the marketplace)
//  POST   /api/designs            -> save { name, canvas_data, thumbnail_url, product_type }
//  POST   /api/designs/preview    -> upload a rendered canvas PNG, returns { url }
//  DELETE /api/designs/:id        -> delete (owner only)
//
// Works in BOTH local and supabase mode.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const { supabase, MODE, getServiceClient } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireUser } = require('../middleware/auth');
const { restoreThumbnailFile } = require('../services/thumbnails');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'images');
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

function db(req) {
  return getServiceClient() || (req && req.supabase) || supabase;
}

// POST /api/designs/preview — { data_url } from canvas.toDataURL('image/png')
// Declared before /:id so "preview" is never read as an id.
router.post('/preview', getUser, requireUser, (req, res, next) => {
  try {
    const dataUrl = (req.body && req.body.data_url) || '';
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return res.status(400).json({ error: 'Expected a PNG, JPEG or WebP data URL.' });

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_PREVIEW_BYTES) {
      return res.status(413).json({ error: 'Preview image is too large (max 6MB).' });
    }

    const ext = match[1] === 'jpeg' ? '.jpg' : '.' + match[1];
    const name = 'design_' + crypto.randomBytes(10).toString('hex') + ext;
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, name), buffer);
    res.json({ url: '/images/' + name });
  } catch (e) { next(e); }
});

// GET /api/designs
router.get('/', getUser, requireUser, async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const designs = (store.raw.designs || [])
        .filter(d => d.user_id === req.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      designs.forEach(d => restoreThumbnailFile(d.thumbnail_url, d.canvas_data));
      return res.json(designs);
    }
    const { data, error } = await db(req).from('designs').select('*')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    (data || []).forEach(d => restoreThumbnailFile(d.thumbnail_url, d.canvas_data));
    res.json(data || []);
  } catch (e) { next(e); }
});

// GET /api/designs/:id — own design, or one that is published as an active listing
// (so anyone can remix a public design).
router.get('/:id', getUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user && req.user.id;

    if (MODE === 'local') {
      const d = (store.raw.designs || []).find(x => x.id === id);
      if (!d) return res.status(404).json({ error: 'Design not found' });
      const published = (store.raw.listings || []).some(l => l.design_id === id && l.status === 'active');
      if (d.user_id !== userId && !published) return res.status(403).json({ error: 'This design is private.' });
      restoreThumbnailFile(d.thumbnail_url, d.canvas_data);
      return res.json(d);
    }

    const sb = db(req);
    const { data, error } = await sb.from('designs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Design not found' });
    if (data.user_id !== userId) {
      const { data: listing } = await sb.from('listings').select('id')
        .eq('design_id', id).eq('status', 'active').maybeSingle();
      if (!listing) return res.status(403).json({ error: 'This design is private.' });
    }
    restoreThumbnailFile(data.thumbnail_url, data.canvas_data);
    res.json(data);
  } catch (e) { next(e); }
});

// POST /api/designs
router.post('/', getUser, requireUser, async (req, res, next) => {
  try {
    const { name, canvas_data, thumbnail_url, product_type } = req.body || {};
    if (!canvas_data) return res.status(400).json({ error: 'canvas_data is required' });

    const row = {
      user_id: req.user.id,
      name: String(name || 'Untitled design').slice(0, 80),
      canvas_data,
      thumbnail_url: thumbnail_url || null,
      product_type: product_type || 'tshirt'
    };

    if (MODE === 'local') {
      const design = Object.assign({ id: store.nextId('design'), created_at: new Date().toISOString() }, row);
      store.raw.designs.push(design);
      store.persist();
      return res.json({ design });
    }

    const { data, error } = await db(req).from('designs').insert(row).select('*').single();
    if (error) throw error;
    res.json({ design: data });
  } catch (e) { next(e); }
});

// DELETE /api/designs/:id
router.delete('/:id', getUser, requireUser, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (MODE === 'local') {
      const before = store.raw.designs.length;
      store.raw.designs = store.raw.designs.filter(d => !(d.id === id && d.user_id === req.user.id));
      store.persist();
      return res.json({ ok: store.raw.designs.length < before });
    }

    const { error } = await db(req).from('designs').delete().eq('id', id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
