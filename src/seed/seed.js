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

    return;
  }

  // SUPABASE mode — upsert products every boot (keeps data in sync with products.json).
  if (MODE === 'supabase') {
    (async () => {
      for (const p of products) {
        const { error } = await supabase.from('products').upsert({
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
        }, { onConflict: 'slug' });
        if (error) console.warn('[seed] error on ' + p.slug + ':', error.message);
      }
      console.log('[seed] supabase upsert done for ' + products.length + ' products.');
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
