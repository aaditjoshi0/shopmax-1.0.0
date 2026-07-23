// A simple file-backed JSON store used when Supabase is not configured yet.
// Lets the entire site run out of the box for demos. Data is persisted to
// src/db/_localdata.json so it survives server restarts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '_localdata.json');

// Shape of the store. Seeded products are loaded from products.json by seed.js.
const DEFAULTS = {
  profiles: [],
  products: [],
  carts: [],          // { id, user_id, items: [{ product_id, name, price, image_url, quantity, size, meta }] }
  orders: [],         // { id, user_id, items, shipping, total, status, created_at }
  designs: [],        // { id, user_id, name, canvas_data, thumbnail_url, product_type, created_at }
  listings: [],       // { id, user_id, title, description, price, image_url, size, category, status, created_at }
  variants: [],       // { id, product_id, sku, size, color, price, compare_at_price, stock, status }
  images: [],         // { id, product_id, color, url, alt, sort_order }
  reviews: [],        // { id, product_id, user_id, user_name, rating, title, comment, created_at }
  ratings: [],        // { id, target_type, target_id, user_id, rating, created_at, updated_at }
  wishlists: [],      // { id, user_id, product_id, created_at }
  users: [],          // local-only auth: { id, email, password (hashed), full_name, mobile, birthdate }
  coupons: [
    { code: 'SHOPMAX10',  type: 'percent', value: 10,  min_cart: 0,   max_uses: 1000, used_count: 0, active: true },
    { code: 'SHOPMAX20',  type: 'percent', value: 20,  min_cart: 0,   max_uses: 500,  used_count: 0, active: true },
    { code: 'FIRSTORDER', type: 'fixed',   value: 100, min_cart: 200, max_uses: 1000, used_count: 0, active: true }
  ],
  counters: { product: 100, order: 100, design: 100, listing: 100, user: 1, variant: 1000, image: 1000 }
};

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    }
  } catch (e) {
    console.warn('[localStore] could not read data file, starting fresh:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

let data = load();

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[localStore] could not write data file:', e.message);
  }
}

function nextId(prefix) {
  data.counters[prefix] = (data.counters[prefix] || 1) + 1;
  return data.counters[prefix];
}

function uid() {
  return crypto.randomBytes(12).toString('hex');
}

// Simple, fast password hash for local demo ONLY (not for production).
// Supabase Auth handles hashing in the real setup.
function hash(pw) {
  return crypto.createHash('sha256').update('shopmax|' + pw).digest('hex');
}

module.exports = {
  get raw() { return data; },
  reset() { data = JSON.parse(JSON.stringify(DEFAULTS)); persist(); },
  persist,
  nextId,
  uid,
  hash,
  reload() { data = load(); return data; }
};
