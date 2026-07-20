// Categories API.
//  GET    /api/categories        -> list all categories
//  POST   /api/categories        -> create category (admin)
//  PUT    /api/categories/:id    -> update category (admin)
//  DELETE /api/categories/:id    -> delete category (admin)

const express = require('express');
const router = express.Router();
const { supabase, MODE } = require('../../config/supabase');
const store = require('../db/localStore');
const { getUser, requireAdmin } = require('../middleware/auth');

// GET /api/categories
router.get('/', async (req, res, next) => {
  try {
    if (MODE === 'local') {
      const cats = store.raw.categories || [];
      return res.json(cats);
    }
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) throw error;
    // Return default categories if table returns empty
    const defaults = [
      { id: 1, name: 'Men', slug: 'men', description: '', hidden: false },
      { id: 2, name: 'Women', slug: 'women', description: '', hidden: false },
      { id: 3, name: 'Home', slug: 'home', description: '', hidden: false },
      { id: 4, name: 'Accessories', slug: 'accessories', description: '', hidden: false }
    ];
    res.json((data && data.length) ? data : defaults);
  } catch (e) { next(e); }
});

// POST /api/categories
router.post('/', getUser, requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, description } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required.' });

    const catSlug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!catSlug) return res.status(400).json({ error: 'Invalid slug.' });

    if (MODE === 'local') {
      if (!store.raw.categories) store.raw.categories = [];
      const exists = store.raw.categories.find(c => c.slug === catSlug);
      if (exists) return res.status(409).json({ error: 'A category with that slug already exists.' });
      const id = store.nextId('category');
      const cat = { id, name, slug: catSlug, description: description || '', hidden: false, created_at: new Date().toISOString() };
      store.raw.categories.push(cat);
      store.persist();
      return res.json({ category: cat });
    }

    const { data, error } = await supabase.from('categories').insert({
      name, slug: catSlug, description: description || ''
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A category with that slug already exists.' });
      throw error;
    }
    res.json({ category: data });
  } catch (e) { next(e); }
});

// PUT /api/categories/:id
router.put('/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, slug, description, hidden } = req.body || {};

    if (MODE === 'local') {
      const cat = (store.raw.categories || []).find(c => c.id === id);
      if (!cat) return res.status(404).json({ error: 'Category not found.' });
      if (name !== undefined) cat.name = name;
      if (slug !== undefined) {
        const newSlug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (!newSlug) return res.status(400).json({ error: 'Invalid slug.' });
        const dup = store.raw.categories.find(c => c.slug === newSlug && c.id !== id);
        if (dup) return res.status(409).json({ error: 'Slug already in use.' });
        cat.slug = newSlug;
      }
      if (description !== undefined) cat.description = description;
      if (hidden !== undefined) cat.hidden = hidden;
      store.persist();
      return res.json({ category: cat });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (description !== undefined) updates.description = description;
    if (hidden !== undefined) updates.hidden = hidden;
    const { data, error } = await supabase.from('categories').update(updates).eq('id', id).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Slug already in use.' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Category not found.' });
    res.json({ category: data });
  } catch (e) { next(e); }
});

// DELETE /api/categories/:id
router.delete('/:id', getUser, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (MODE === 'local') {
      const before = (store.raw.categories || []).length;
      store.raw.categories = (store.raw.categories || []).filter(c => c.id !== id);
      store.persist();
      return res.json({ ok: store.raw.categories.length < before });
    }
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
