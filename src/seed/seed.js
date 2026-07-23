// Seed script.
//  - LOCAL mode: writes the products from products.json into the file store
//    (only if there are no products yet), so the site is populated on first run.
//  - SUPABASE mode: upserts the same products into the products table.
//
// Run with:  npm run seed

const fs = require('fs');
const path = require('path');
const products = require('./products.json');
const { supabase, MODE, isConfigured } = require('../../config/supabase');

function seedIfEmpty(verbose) {
  if (MODE === 'local') {
    const store = require('../db/localStore');
    const data = store.reload();

    // Seed products if empty
    if (data.products.length === 0) {
      data.products = products.map((p, i) => ({
        id: i + 1,
        ...p,
        created_at: new Date().toISOString()
      }));
      if (verbose) console.log('[seed] local store seeded with ' + data.products.length + ' products.');
    } else {
      if (verbose) console.log('[seed] local store already has ' + data.products.length + ' products — skipping.');
    }

    // Seed variants from products with sizes/colors
    if (data.variants.length === 0 && data.products.length > 0) {
      var variantId = store.nextId('variant') || 0;
      data.products.forEach(function (p) {
        var sizes = p.sizes || [];
        var colors = p.colors || [];
        if (sizes.length > 0 || colors.length > 0) {
          var combos = [];
          if (sizes.length > 0 && colors.length > 0) {
            sizes.forEach(function (s) {
              colors.forEach(function (c) {
                var colorName = typeof c === 'object' ? (c.name || '') : String(c);
                combos.push({ size: s, color: colorName });
              });
            });
          } else {
            sizes.forEach(function (s) { combos.push({ size: s, color: '' }); });
            colors.forEach(function (c) {
              var colorName = typeof c === 'object' ? (c.name || '') : String(c);
              combos.push({ size: '', color: colorName });
            });
          }
          if (combos.length === 0) combos.push({ size: '', color: '' });
          var stockPerVariant = Math.floor((p.stock || 100) / combos.length) || 1;
          combos.forEach(function (combo) {
            variantId++;
            data.variants.push({
              id: variantId,
              product_id: p.id,
              sku: p.sku ? p.sku + '-' + combo.size + '-' + combo.color : '',
              size: combo.size,
              color: combo.color,
              price: p.price,
              compare_at_price: p.compare_at_price || null,
              stock: stockPerVariant,
              status: 'published',
              created_at: p.created_at,
              updated_at: p.created_at
            });
          });
        }
      });
      data.counters.variant = variantId;
      store.persist();
      if (verbose) console.log('[seed] ' + data.variants.length + ' variants generated from products.');
    }

    // Seed admin user if no admin exists
    const hasAdmin = data.profiles.some(p => p.role === 'admin');
    if (!hasAdmin) {
      const adminId = 'local-' + store.uid();
      const adminPassword = store.hash('Admin@123456');
      data.users.push({
        id: adminId,
        email: 'admin@shopmax.com',
        full_name: 'ShopMax Admin',
        mobile: '',
        birthdate: '',
        password: adminPassword,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      data.profiles.push({
        id: adminId,
        email: 'admin@shopmax.com',
        full_name: 'ShopMax Admin',
        mobile: '',
        birthdate: '',
        avatar_url: null,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      store.persist();
      if (verbose) console.log('[seed] admin user created (admin@shopmax.com / Admin@123456)');
    }

    // Seed sample ratings for products
    if ((data.ratings || []).length === 0 && data.products.length > 0 && data.users.length > 0) {
      var sampleUserIds = data.users.filter(function (u) { return u.role !== 'admin'; }).map(function (u) { return u.id; });
      if (sampleUserIds.length === 0) sampleUserIds = [data.users[0].id];
      data.ratings = [];
      data.products.forEach(function (p) {
        var numRatings = Math.floor(Math.random() * 3) + 1;
        var usedUsers = {};
        for (var ri = 0; ri < numRatings; ri++) {
          var ruid = sampleUserIds[Math.floor(Math.random() * sampleUserIds.length)];
          if (usedUsers[ruid]) continue;
          usedUsers[ruid] = true;
          data.ratings.push({
            id: data.ratings.length + 1,
            target_type: 'product',
            target_id: p.id,
            user_id: ruid,
            rating: Math.floor(Math.random() * 2) + 4,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
        var productRatings = data.ratings.filter(function (r) { return r.target_type === 'product' && r.target_id === p.id; });
        var rc = productRatings.length;
        p.rating_count = rc;
        if (rc) {
          p.rating = Math.round(productRatings.reduce(function (s, r) { return s + r.rating; }, 0) / rc * 10) / 10;
        }
      });
      store.persist();
      if (verbose) console.log('[seed] ' + data.ratings.length + ' sample ratings generated.');
    }

    return;
  }

  // SUPABASE mode — upsert products every boot (keeps data in sync with products.json).
  if (MODE === 'supabase') {
    (async () => {
      for (const p of products) {
        const { data: upserted, error } = await supabase.from('products').upsert({
          name: p.name,
          slug: p.slug,
          description: p.description,
          price: p.price,
          compare_at_price: p.compare_at_price,
          category: p.category,
          image_url: p.image_url,
          stock: p.stock,
          sizes: p.sizes,
          rating: p.rating,
          featured: p.featured,
          colors: p.colors || null,
          status: p.status || 'published'
        }, { onConflict: 'slug' }).select('id, slug, sizes, colors, stock, price, compare_at_price, sku').single();
        if (error) {
          console.warn('[seed] error on ' + p.slug + ':', error.message);
          return;
        }
        // Generate variants for products with sizes/colors
        if (upserted && ((p.sizes && p.sizes.length > 0) || (p.colors && p.colors.length > 0))) {
          const sizes = p.sizes || [];
          const colors = p.colors || [];
          const combos = [];
          if (sizes.length > 0 && colors.length > 0) {
            sizes.forEach(s => { colors.forEach(c => { combos.push({ size: s, color: typeof c === 'object' ? (c.name || '') : String(c) }); }); });
          } else {
            sizes.forEach(s => combos.push({ size: s, color: '' }));
            colors.forEach(c => combos.push({ size: '', color: typeof c === 'object' ? (c.name || '') : String(c) }));
          }
          if (combos.length === 0) combos.push({ size: '', color: '' });
          const stockPer = Math.floor((p.stock || 100) / combos.length) || 1;
          for (const combo of combos) {
            const sku = p.sku ? p.sku + '-' + combo.size + '-' + combo.color : '';
            const { error: vErr } = await supabase.from('product_variants').upsert({
              product_id: upserted.id,
              sku,
              size: combo.size,
              color: combo.color,
              price: p.price,
              compare_at_price: p.compare_at_price || null,
              stock: stockPer,
              status: 'published'
            }, { onConflict: 'product_id,size,color' });
            if (vErr && vErr.code !== '23505') console.warn('[seed] variant error for ' + p.slug + ':', vErr.message);
          }
        }
      }
      console.log('[seed] supabase upsert done for ' + products.length + ' products + variants.');
    })();
    return;
  }
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  seedIfEmpty(true);
  if (isConfigured()) {
    // async supabase path logs from within
  } else {
    // already logged inside seedIfEmpty
  }
}
