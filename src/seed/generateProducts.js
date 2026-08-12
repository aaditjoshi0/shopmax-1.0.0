// Procedural clothing-product generator.
//
// Replaces the old products.json fixture: instead of shipping a fixed list, we
// build every product from word pools at seed time. Each product is guaranteed
// unique — names/slugs/SKUs are drawn from a shuffled pool of distinct
// (style x fabric x garment) combinations, so no two products can collide.
//
// Usage:
//   const { generateProducts } = require('./generateProducts');
//   const products = generateProducts(60);            // random every run
//   const products = generateProducts(60, 12345);     // reproducible

// ---------------------------------------------------------------- rng

// mulberry32 — small deterministic PRNG so a given seed always yields the same
// catalogue (handy when you want two machines to seed identically).
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickSome(rng, arr, n) {
  const copy = arr.slice();
  shuffle(rng, copy);
  return copy.slice(0, Math.min(n, copy.length));
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------- word pools

const STYLES = [
  'Classic', 'Relaxed', 'Tailored', 'Oversized', 'Vintage', 'Everyday',
  'Heritage', 'Modern', 'Slim-Fit', 'Cropped', 'Essential', 'Luxe',
  'Weekend', 'Signature', 'Urban', 'Coastal', 'Studio', 'Alpine',
  'Boxy', 'Draped'
];

// `tag` groups fabrics so garments can opt into only the ones that make sense
// (no fleece dresses, no poplin jeans).
const FABRICS = [
  { name: 'Cotton',    note: 'breathable combed cotton',  premium: 0,  tag: 'woven' },
  { name: 'Linen',     note: '100% washed linen',         premium: 10, tag: 'woven' },
  { name: 'Twill',     note: 'brushed cotton twill',      premium: 6,  tag: 'woven' },
  { name: 'Poplin',    note: 'crisp yarn-dyed poplin',    premium: 5,  tag: 'shirting' },
  { name: 'Chambray',  note: 'lightweight chambray',      premium: 7,  tag: 'shirting' },
  { name: 'Oxford',    note: 'textured oxford cloth',     premium: 6,  tag: 'shirting' },
  { name: 'Denim',     note: 'mid-weight rigid denim',    premium: 8,  tag: 'heavy' },
  { name: 'Corduroy',  note: '8-wale cotton corduroy',    premium: 12, tag: 'heavy' },
  { name: 'Canvas',    note: 'dry cotton canvas',         premium: 9,  tag: 'heavy' },
  { name: 'Merino',    note: 'fine-gauge merino wool',    premium: 22, tag: 'knit' },
  { name: 'Cashmere',  note: 'two-ply cashmere blend',    premium: 40, tag: 'knit' },
  { name: 'Lambswool', note: 'soft lambswool yarn',       premium: 20, tag: 'knit' },
  { name: 'Jersey',    note: 'soft single-jersey knit',   premium: 0,  tag: 'jersey' },
  { name: 'Ribbed',    note: 'stretch rib knit',          premium: 4,  tag: 'jersey' },
  { name: 'Fleece',    note: 'loopback fleece',           premium: 9,  tag: 'sweat' },
  { name: 'Terry',     note: 'french terry',              premium: 6,  tag: 'sweat' },
  { name: 'Satin',     note: 'fluid satin weave',         premium: 14, tag: 'drape' },
  { name: 'Crepe',     note: 'soft-handle crepe',         premium: 12, tag: 'drape' },
  { name: 'Velvet',    note: 'plush cotton velvet',       premium: 18, tag: 'drape' }
];

// gender: which category the garment belongs to. 'any' garments are generated
// under both men and women so the two catalogues stay distinct.
// fabrics: which FABRIC tags this garment may be made from.
const GARMENTS = [
  { name: 'Shirt',       gender: 'any',   base: 34,  sized: 'apparel', img: 'top',       fabrics: ['shirting', 'woven'] },
  { name: 'Overshirt',   gender: 'any',   base: 52,  sized: 'apparel', img: 'top',       fabrics: ['heavy', 'woven'] },
  { name: 'Tee',         gender: 'any',   base: 19,  sized: 'apparel', img: 'top',       fabrics: ['jersey'] },
  { name: 'Polo',        gender: 'any',   base: 29,  sized: 'apparel', img: 'top',       fabrics: ['jersey', 'knit'] },
  { name: 'Hoodie',      gender: 'any',   base: 48,  sized: 'apparel', img: 'top',       fabrics: ['sweat'] },
  { name: 'Sweatshirt',  gender: 'any',   base: 42,  sized: 'apparel', img: 'top',       fabrics: ['sweat'] },
  { name: 'Crewneck',    gender: 'any',   base: 45,  sized: 'apparel', img: 'top',       fabrics: ['knit', 'sweat'] },
  { name: 'Cardigan',    gender: 'any',   base: 58,  sized: 'apparel', img: 'top',       fabrics: ['knit'] },
  { name: 'Jacket',      gender: 'any',   base: 74,  sized: 'apparel', img: 'outer',     fabrics: ['heavy', 'woven'] },
  { name: 'Bomber',      gender: 'any',   base: 82,  sized: 'apparel', img: 'outer',     fabrics: ['heavy', 'woven'] },
  { name: 'Parka',       gender: 'any',   base: 118, sized: 'apparel', img: 'outer',     fabrics: ['heavy'] },
  { name: 'Trench Coat', gender: 'any',   base: 132, sized: 'apparel', img: 'outer',     fabrics: ['heavy', 'woven'] },
  { name: 'Gilet',       gender: 'any',   base: 64,  sized: 'apparel', img: 'outer',     fabrics: ['heavy', 'knit'] },
  { name: 'Chinos',      gender: 'any',   base: 46,  sized: 'waist',   img: 'bottom',    fabrics: ['woven', 'heavy'] },
  { name: 'Jeans',       gender: 'any',   base: 54,  sized: 'waist',   img: 'bottom',    fabrics: ['heavy'] },
  { name: 'Trousers',    gender: 'any',   base: 58,  sized: 'waist',   img: 'bottom',    fabrics: ['woven', 'drape', 'heavy'] },
  { name: 'Shorts',      gender: 'any',   base: 27,  sized: 'waist',   img: 'bottom',    fabrics: ['woven', 'heavy'] },
  { name: 'Joggers',     gender: 'any',   base: 38,  sized: 'apparel', img: 'bottom',    fabrics: ['sweat', 'jersey'] },
  { name: 'Scarf',       gender: 'any',   base: 22,  sized: 'onesize', img: 'accessory', fabrics: ['knit', 'woven'] },
  { name: 'Beanie',      gender: 'any',   base: 18,  sized: 'onesize', img: 'accessory', fabrics: ['knit'] },
  { name: 'Cap',         gender: 'any',   base: 16,  sized: 'onesize', img: 'accessory', fabrics: ['woven', 'heavy'] },
  { name: 'Blazer',      gender: 'men',   base: 96,  sized: 'apparel', img: 'outer',     fabrics: ['woven', 'heavy', 'drape'] },
  { name: 'Henley',      gender: 'men',   base: 26,  sized: 'apparel', img: 'top',       fabrics: ['jersey'] },
  { name: 'Waistcoat',   gender: 'men',   base: 62,  sized: 'apparel', img: 'top',       fabrics: ['woven', 'heavy'] },
  { name: 'Midi Dress',  gender: 'women', base: 68,  sized: 'apparel', img: 'top',       fabrics: ['drape', 'woven', 'jersey'] },
  { name: 'Wrap Dress',  gender: 'women', base: 72,  sized: 'apparel', img: 'top',       fabrics: ['drape', 'woven'] },
  { name: 'Slip Dress',  gender: 'women', base: 59,  sized: 'apparel', img: 'top',       fabrics: ['drape'] },
  { name: 'Blouse',      gender: 'women', base: 38,  sized: 'apparel', img: 'top',       fabrics: ['shirting', 'drape'] },
  { name: 'Camisole',    gender: 'women', base: 24,  sized: 'apparel', img: 'top',       fabrics: ['drape', 'jersey'] },
  { name: 'Midi Skirt',  gender: 'women', base: 44,  sized: 'waist',   img: 'bottom',    fabrics: ['woven', 'drape', 'heavy'] },
  { name: 'Pleated Skirt', gender: 'women', base: 47, sized: 'waist',  img: 'bottom',    fabrics: ['drape', 'woven'] },
  { name: 'Jumpsuit',    gender: 'women', base: 78,  sized: 'apparel', img: 'top',       fabrics: ['woven', 'heavy', 'drape'] },
  { name: 'Lounge Set',  gender: 'home',  base: 56,  sized: 'apparel', img: 'top',       fabrics: ['sweat', 'jersey', 'woven'] },
  { name: 'Robe',        gender: 'home',  base: 49,  sized: 'apparel', img: 'top',       fabrics: ['sweat', 'woven', 'drape'] },
  { name: 'Pyjama Set',  gender: 'home',  base: 44,  sized: 'apparel', img: 'top',       fabrics: ['woven', 'jersey', 'shirting'] },
  { name: 'Sleep Shirt', gender: 'home',  base: 32,  sized: 'apparel', img: 'top',       fabrics: ['jersey', 'shirting'] },
  { name: 'Lounge Pants', gender: 'home', base: 36,  sized: 'apparel', img: 'bottom',    fabrics: ['sweat', 'jersey', 'woven'] },
  { name: 'Knit Throw',  gender: 'home',  base: 68,  sized: 'onesize', img: 'accessory', fabrics: ['knit'] }
];

const COLORS = [
  { name: 'Black',    hex: '#1a1a1a' },
  { name: 'Ivory',    hex: '#f2ede4' },
  { name: 'Charcoal', hex: '#3a3f44' },
  { name: 'Navy',     hex: '#1a2940' },
  { name: 'Indigo',   hex: '#2c5f8a' },
  { name: 'Olive',    hex: '#5a6b3f' },
  { name: 'Sand',     hex: '#d6c3a1' },
  { name: 'Rust',     hex: '#a1502c' },
  { name: 'Burgundy', hex: '#6b1f2e' },
  { name: 'Forest',   hex: '#255140' },
  { name: 'Slate',    hex: '#6b7280' },
  { name: 'Cream',    hex: '#efe6d3' },
  { name: 'Mustard',  hex: '#d4a017' },
  { name: 'Sage',     hex: '#9caf88' },
  { name: 'Dusty Rose', hex: '#c08a8a' },
  { name: 'Cobalt',   hex: '#2b4fa2' },
  { name: 'Stone',    hex: '#b7ada0' },
  { name: 'Plum',     hex: '#5e3a5e' }
];

// Only images that actually ship in /images.
const IMAGES = {
  top:       ['images/model_1.png', 'images/model_2.png', 'images/model_3.png', 'images/model_4.png', 'images/model_6.png', 'images/cloth_1.jpg', 'images/cloth_2.jpg'],
  outer:     ['images/model_5.png', 'images/model_7.png', 'images/cloth_3.jpg', 'images/model_2.png'],
  bottom:    ['images/prod_1.png', 'images/prod_2.png', 'images/prod_3.png', 'images/cloth_1.jpg'],
  accessory: ['images/prod_1.png', 'images/prod_2.png', 'images/prod_3.png', 'images/shoe.png']
};

const SIZE_SETS = {
  apparel: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  waist:   ['28', '30', '32', '34', '36', '38'],
  onesize: ['One Size']
};

const FIT_NOTES = [
  'Cut for an easy, unrestricted fit.',
  'Trim through the body with room to move.',
  'Sits true to size — take your usual.',
  'Generous through the shoulder for a relaxed drape.',
  'A slightly longer body keeps it tucked or loose.',
  'Softly structured, so it holds shape without stiffness.'
];

const CARE_NOTES = [
  'Machine wash cold, hang to dry.',
  'Wash inside out and tumble low.',
  'Cold hand wash keeps the colour deep.',
  'Gentle cycle, reshape while damp.',
  'Dry flat to keep the finish even.'
];

const DETAIL_NOTES = [
  'Finished with matched-tone stitching and a woven hem label.',
  'Reinforced seams and horn-effect buttons throughout.',
  'Side seam pockets and a clean bound neckline.',
  'Garment-dyed in small batches, so no two pieces fade alike.',
  'Pre-shrunk, so it comes out of the first wash the same size it went in.',
  'A single chest pocket and a split hem for movement.'
];

// ---------------------------------------------------------------- helpers

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Every distinct (style, fabric, garment, category) triple the pools allow.
// Shuffling this and taking the first N guarantees uniqueness without retries.
function buildCombos() {
  const combos = [];
  for (const g of GARMENTS) {
    const cats = g.gender === 'any' ? ['men', 'women'] : [g.gender];
    for (const cat of cats) {
      const fabrics = FABRICS.filter(f => g.fabrics.indexOf(f.tag) !== -1);
      for (const style of STYLES) {
        for (const fabric of fabrics) {
          combos.push({ garment: g, category: cat, style, fabric });
        }
      }
    }
  }
  return combos;
}

function buildDescription(rng, combo) {
  const g = combo.garment.name.toLowerCase();
  const opener = pick(rng, [
    `A ${combo.style.toLowerCase()} ${g} in ${combo.fabric.note}.`,
    `Our ${combo.style.toLowerCase()} take on the ${g}, made in ${combo.fabric.note}.`,
    `${combo.style} ${g} cut from ${combo.fabric.note}.`
  ]);
  return [opener, pick(rng, FIT_NOTES), pick(rng, DETAIL_NOTES), pick(rng, CARE_NOTES)].join(' ');
}

// ---------------------------------------------------------------- generator

/**
 * Build `count` unique clothing products.
 * @param {number} count  how many products to generate (default 60)
 * @param {number} [seed] optional PRNG seed for reproducible output
 * @returns {Array<object>} products shaped like the old products.json entries
 */
function generateProducts(count, seed) {
  const n = count || 60;
  const rng = makeRng(typeof seed === 'number' ? seed : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  const combos = shuffle(rng, buildCombos());
  if (n > combos.length) {
    throw new Error('[generateProducts] requested ' + n + ' products but only ' + combos.length + ' unique combinations exist.');
  }

  const usedSlugs = new Set();
  const usedSkus = new Set();
  const products = [];

  for (let i = 0; products.length < n && i < combos.length; i++) {
    const c = combos[i];
    const name = c.style + ' ' + c.fabric.name + ' ' + c.garment.name;
    const slug = slugify(name);
    if (usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);

    // Price: garment base + fabric premium, nudged +/-15%, ending in .00 or .50.
    const raw = (c.garment.base + c.fabric.premium) * (0.85 + rng() * 0.3);
    const price = Math.max(9, Math.round(raw * 2) / 2);
    // ~40% of products carry a strike-through compare price.
    const onSale = rng() < 0.4;
    const compare_at_price = onSale ? Math.round(price * (1.2 + rng() * 0.45) * 2) / 2 : null;

    const sizes = SIZE_SETS[c.garment.sized].slice();
    // Trim the apparel range on some items so not everything runs XS–XXL.
    if (c.garment.sized === 'apparel' && rng() < 0.5) sizes.splice(0, 1);
    if (c.garment.sized === 'waist' && rng() < 0.4) sizes.pop();

    const imagePool = IMAGES[c.garment.img];
    const image_url = pick(rng, imagePool);

    const colorCount = randInt(rng, 2, 4);
    const colors = pickSome(rng, COLORS, colorCount).map(function (col) {
      return {
        name: col.name,
        hex: col.hex,
        image_url: pick(rng, imagePool)
      };
    });

    const skuBase = (c.garment.name.replace(/[^A-Za-z]/g, '').slice(0, 3) + c.fabric.name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase();
    let sku = skuBase + '-' + String(1000 + products.length);
    while (usedSkus.has(sku)) sku = skuBase + '-' + String(1000 + products.length + randInt(rng, 1, 999));
    usedSkus.add(sku);

    products.push({
      name: name,
      slug: slug,
      sku: sku,
      description: buildDescription(rng, c),
      price: price,
      compare_at_price: compare_at_price,
      category: c.category,
      image_url: image_url,
      stock: randInt(rng, 8, 120),
      sizes: sizes,
      rating: Math.round((3.6 + rng() * 1.4) * 10) / 10,
      featured: rng() < 0.18,
      colors: colors,
      status: 'published'
    });
  }

  return products;
}

module.exports = { generateProducts };

// `node src/seed/generateProducts.js [count] [seed]` prints the catalogue as
// JSON — useful for eyeballing output without touching the store.
if (require.main === module) {
  const count = parseInt(process.argv[2], 10) || 60;
  const seedArg = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  process.stdout.write(JSON.stringify(generateProducts(count, seedArg), null, 2) + '\n');
}
