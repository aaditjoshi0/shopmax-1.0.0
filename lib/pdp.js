// PDP helpers ported from js/product.js + js/app.js (same markup/classes).
// HTML-string helpers are rendered via dangerouslySetInnerHTML so the
// design (sm-pdp-*, sm-tab-*, sm-fw-*) matches the original exactly.

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

export function colorDisplay(c) { return typeof c === 'object' && c !== null ? c.name : String(c); }

export function findVariant(variants, size, color) {
  if (!variants) return null;
  return variants.find((v) => v.status === 'published' && v.size === size && v.color === color)
    || variants.find((v) => v.status === 'published' && v.size === size)
    || variants.find((v) => v.status === 'published' && v.color === color)
    || null;
}

export function getVariantStock(p, size, color) {
  if (!p.variants) return p.stock || 0;
  const v = findVariant(p.variants, size, color);
  return v ? v.stock : 0;
}

export function starHtml(rating) {
  rating = Number(rating) || 0;
  let html = '<span class="star-rating">';
  for (let i = 1; i <= 5; i++) {
    html += '<span class="icon-star2 ' + (i <= Math.round(rating) ? 'text-warning' : 'text-muted') + '"></span>';
  }
  return html + '</span>';
}

export function ratingDisplayHtml(rating, count) {
  rating = Number(rating) || 0;
  count = Number(count) || 0;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    stars += '<span class="icon-star2 ' + (i <= Math.round(rating) ? 'text-warning' : 'text-muted') + '"></span>';
  }
  return '<div class="sm-rating-display">' +
    '<span class="sm-rating-stars">' + stars + '</span>' +
    '<span class="sm-rating-text">' + rating.toFixed(1) + ' / 5</span>' +
    '<span class="sm-rating-count">(' + count + ' Rating' + (count !== 1 ? 's' : '') + ')</span>' +
  '</div>';
}

export function ratingInputHtml(currentRating) {
  currentRating = Number(currentRating) || 0;
  let html = '<div class="sm-rating-input">';
  for (let i = 1; i <= 5; i++) {
    html += '<span class="sm-rating-star' + (i <= currentRating ? ' active' : '') + '" data-val="' + i + '">&#9733;</span>';
  }
  return html + '</div>';
}

const BENEFIT_MAP = {
  free_delivery:  { label: 'Free Delivery',      icon: 'icon-truck',        desc: 'Free delivery on all orders' },
  cod:            { label: 'Cash On Delivery',   icon: 'icon-money',        desc: 'Pay after delivery' },
  return_7:       { label: '7 Days Return',      icon: 'icon-refresh',      desc: 'Easy returns, 7 days' },
  return_10:      { label: '10 Days Return',     icon: 'icon-refresh',      desc: 'Easy returns, 10 days' },
  return_30:      { label: '30 Days Return',     icon: 'icon-refresh',      desc: 'Easy returns, 30 days' },
  exchange:       { label: 'Exchange Available', icon: 'icon-retweet',      desc: 'Easy exchange available' },
  secure_payment: { label: 'Secure Payment',     icon: 'icon-lock',         desc: '100% secure checkout' },
  top_brand:      { label: 'Top Brand',          icon: 'icon-trophy',       desc: 'Trusted quality brand' },
  warranty:       { label: 'Warranty Available', icon: 'icon-shield',       desc: 'Manufacturer warranty' },
  fast_delivery:  { label: 'Fast Delivery',      icon: 'icon-flash',        desc: 'Delivered in 1-2 days' },
  same_day:       { label: 'Same Day Delivery',  icon: 'icon-plane',        desc: 'Same day dispatch' },
  official_store: { label: 'Official Store',     icon: 'icon-check-circle', desc: 'Authentic products only' },
  sustainable:    { label: 'Sustainable Product',icon: 'icon-leaf',         desc: 'Eco-friendly choice' },
  customizable:   { label: 'Customizable',       icon: 'icon-wrench',       desc: 'Customize your product' },
  premium:        { label: 'Premium Product',    icon: 'icon-diamond',      desc: 'Best quality guaranteed' },
  limited_stock:  { label: 'Limited Stock',      icon: 'icon-warning',      desc: 'Hurry, only few left' },
};

export function benefitBadgesHtml(ids) {
  if (!ids || !ids.length) return '';
  return ids.map((id) => {
    const b = BENEFIT_MAP[id];
    if (!b) return '';
    return '<div class="sm-benefit-card">' +
      '<div class="sm-benefit-card-icon"><span class="' + b.icon + '"></span></div>' +
      '<div class="sm-benefit-card-text">' +
        '<div class="sm-benefit-card-title">' + b.label + '</div>' +
        '<div class="sm-benefit-card-desc">' + (b.desc || '') + '</div>' +
      '</div></div>';
  }).join('');
}

/* ---------------- size guides (ported verbatim logic) ---------------- */

const MENS_FOOTWEAR = [
  { uk: '5', eu: '38.5', us: '6', mm: 235 }, { uk: '5.5', eu: '39', us: '6.5', mm: 240 },
  { uk: '6', eu: '39.5', us: '7', mm: 245 }, { uk: '6.5', eu: '40', us: '7.5', mm: 250 },
  { uk: '7', eu: '41', us: '8', mm: 255 }, { uk: '7.5', eu: '42', us: '8.5', mm: 260 },
  { uk: '8', eu: '42.5', us: '9', mm: 265 }, { uk: '8.5', eu: '43', us: '9.5', mm: 270 },
  { uk: '9', eu: '44', us: '10', mm: 275 }, { uk: '9.5', eu: '44.5', us: '10.5', mm: 280 },
  { uk: '10', eu: '45', us: '11', mm: 285 }, { uk: '10.5', eu: '45.5', us: '11.5', mm: 290 },
  { uk: '11', eu: '46', us: '12', mm: 295 }, { uk: '11.5', eu: '46.5', us: '12.5', mm: 300 },
  { uk: '12', eu: '47', us: '13', mm: 305 }, { uk: '13', eu: '48', us: '14', mm: 315 },
];
const WOMENS_FOOTWEAR = [
  { uk: '2', eu: '35', us: '4', mm: 210 }, { uk: '2.5', eu: '35.5', us: '4.5', mm: 214 },
  { uk: '3', eu: '36', us: '5', mm: 220 }, { uk: '3.5', eu: '37', us: '5.5', mm: 225 },
  { uk: '4', eu: '37.5', us: '6', mm: 230 }, { uk: '4.5', eu: '38', us: '6.5', mm: 235 },
  { uk: '5', eu: '38.5', us: '7', mm: 238 }, { uk: '5.5', eu: '39', us: '7.5', mm: 245 },
  { uk: '6', eu: '39.5', us: '8', mm: 250 }, { uk: '6.5', eu: '40', us: '8.5', mm: 255 },
  { uk: '7', eu: '41', us: '9', mm: 260 }, { uk: '7.5', eu: '42', us: '9.5', mm: 265 },
  { uk: '8', eu: '42.5', us: '10', mm: 270 }, { uk: '8.5', eu: '43', us: '10.5', mm: 275 },
  { uk: '9', eu: '44', us: '11', mm: 280 },
];

const FOOTWEAR_MEASURE_TIP =
  '<h4 class="sm-fw-measure-title">How to Measure Your Foot</h4>' +
  '<ol class="sm-fw-measure-steps">' +
  '<li>Place a sheet of A4 paper flat against a wall, long edge touching it.</li>' +
  '<li>Stand on the paper with your heel touching the wall. Wear the socks you will use.</li>' +
  '<li>Mark the tip of your longest toe on the paper.</li>' +
  '<li>Measure the distance from the wall to the mark in millimetres — that is your foot length.</li>' +
  '<li>Buy the chart size whose foot length is equal to or just greater than yours.</li></ol>' +
  '<div class="sm-fw-measure-note"><strong>If between sizes:</strong> check the product / brand\'s own size chart when available — sizing varies by brand and lasts vary by maker. ' +
  'For wide feet, choose <em>Wide</em> or <em>Extra Wide</em> options where the product offers them.</div>';

function footwearTableHtml(chart) {
  const body = chart.map((r) =>
    '<tr><td class="sm-fw-size">' + escHtml(r.uk) + '</td><td>' + escHtml(r.eu) + '</td><td>' +
    escHtml(r.us) + '</td><td>' + Number(r.mm) + ' mm (' + (Number(r.mm) / 10).toFixed(1) + ' cm)</td></tr>'
  ).join('');
  return '<table class="sm-size-guide-table sm-fw-table"><thead>' +
    '<tr><th>UK</th><th>EU</th><th>US</th><th>Foot Length</th></tr></thead><tbody>' + body + '</tbody></table>';
}

function buildFootwearSizeGuideHtml(p) {
  const gender = String(p.gender || 'unisex').toLowerCase();
  const menChart = (p.attributes && (p.attributes.footwear_chart_men || p.attributes.chart_men)) || MENS_FOOTWEAR;
  const womenChart = (p.attributes && (p.attributes.footwear_chart_women || p.attributes.chart_women)) || WOMENS_FOOTWEAR;
  const widthFit = (p.attributes && p.attributes.width_fit) || null;
  let html = '<div class="sm-tab-sizeguide sm-fw-sizeguide">' +
    '<p class="sm-fw-intro">Footwear sizing — a guide only. Sizes and fits vary by brand, last shape and model. ' +
    'Always check the brand\'s own size chart on the product page when available.</p>';
  const menActive = (gender === 'men' || gender === 'unisex') ? ' sm-fw-active' : '';
  const womenActive = (gender === 'women') ? ' sm-fw-active' : '';
  html += '<div class="sm-fw-tables">' +
    '<div class="sm-fw-block' + menActive + '"><h4 class="sm-fw-block-title">Men\'s Footwear</h4>' + footwearTableHtml(menChart) + '</div>' +
    '<div class="sm-fw-block' + womenActive + '"><h4 class="sm-fw-block-title">Women\'s Footwear</h4>' + footwearTableHtml(womenChart) + '</div></div>';
  if (widthFit && widthFit.length) {
    html += '<div class="sm-fw-width"><h4 class="sm-fw-width-title">Width / Fit options on this product</h4>' +
      '<div class="sm-fw-width-list">' + widthFit.map((w) => '<span class="sm-fw-width-chip">' + escHtml(w) + '</span>').join('') + '</div></div>';
  } else {
    html += '<div class="sm-fw-width sm-fw-width-generic"><strong>Width / Fit:</strong> where available, options are <em>Standard</em>, <em>Wide</em> and <em>Extra Wide</em>. ' +
      'Not all products offer every width — select at variant level.</div>';
  }
  return html + FOOTWEAR_MEASURE_TIP + '</div>';
}

function buildBeltSizeGuideHtml() {
  const rows = [
    { size: 'S', waist: 28, belt: 32 }, { size: 'M', waist: 32, belt: 36 }, { size: 'L', waist: 36, belt: 40 },
    { size: 'XL', waist: 40, belt: 44 }, { size: 'XXL', waist: 44, belt: 48 },
  ];
  const body = rows.map((r) => '<tr><td>' + r.size + '</td><td>' + r.waist + '"</td><td>' + r.belt + '"</td></tr>').join('');
  return '<div class="sm-tab-sizeguide"><p>Belt length is measured from the buckle prong to the middle hole.</p>' +
    '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Waist (inch)</th><th>Belt Length (inch)</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>' +
    '<p class="sm-fw-measure-note">If between sizes, size up — belts sit better at the middle hole.</p></div>';
}

function buildHatSizeGuideHtml() {
  const rows = [
    { size: 'S/M', head_inch: 21.5, head_cm: 55 }, { size: 'M/L', head_inch: 22.5, head_cm: 57 },
    { size: 'L/XL', head_inch: 23.5, head_cm: 60 }, { size: 'One Size', head_inch: 'Adjustable', head_cm: 'Adjustable' },
  ];
  const body = rows.map((r) => '<tr><td>' + r.size + '</td><td>' + r.head_inch + '</td><td>' + r.head_cm + '</td></tr>').join('');
  return '<div class="sm-tab-sizeguide"><p>Measure around the widest part of your head (above the ears and eyebrows).</p>' +
    '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Head Circumference (inch)</th><th>Head Circumference (cm)</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

function buildSocksSizeGuideHtml() {
  const rows = [
    { size: 'S', uk_shoe: '3-5', eu: '35-38', us: '4-6' }, { size: 'M', uk_shoe: '6-8', eu: '39-42', us: '7-9' },
    { size: 'L', uk_shoe: '9-11', eu: '43-46', us: '10-12' }, { size: 'XL', uk_shoe: '12-14', eu: '47-49', us: '13-15' },
  ];
  const body = rows.map((r) => '<tr><td>' + r.size + '</td><td>UK ' + r.uk_shoe + '</td><td>EU ' + r.eu + '</td><td>US ' + r.us + '</td></tr>').join('');
  return '<div class="sm-tab-sizeguide"><p>Socks sizing by UK / EU / US shoe size.</p>' +
    '<table class="sm-size-guide-table"><thead><tr><th>Sock Size</th><th>UK Shoe</th><th>EU Shoe</th><th>US Shoe</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

function buildRingSizeGuideHtml() {
  const rows = [
    { label: 'H 1/2', us: '3.75', eu: '46.8', mm: 14.9 }, { label: 'I 1/2', us: '4.25', eu: '48.0', mm: 15.3 },
    { label: 'J 1/2', us: '4.75', eu: '49.3', mm: 15.7 }, { label: 'K 1/2', us: '5.25', eu: '50.6', mm: 16.1 },
    { label: 'L 1/2', us: '5.75', eu: '51.9', mm: 16.5 }, { label: 'M 1/2', us: '6.25', eu: '53.2', mm: 16.9 },
    { label: 'N 1/2', us: '6.75', eu: '54.5', mm: 17.3 }, { label: 'O 1/2', us: '7.25', eu: '55.8', mm: 17.7 },
    { label: 'P 1/2', us: '7.75', eu: '57.1', mm: 18.1 }, { label: 'Q 1/2', us: '8.25', eu: '58.4', mm: 18.5 },
    { label: 'R 1/2', us: '8.75', eu: '59.7', mm: 19.0 }, { label: 'S 1/2', us: '9.25', eu: '61.0', mm: 19.4 },
    { label: 'T 1/2', us: '9.75', eu: '62.3', mm: 19.8 }, { label: 'U 1/2', us: '10.25', eu: '63.6', mm: 20.2 },
    { label: 'V 1/2', us: '10.75', eu: '64.9', mm: 20.6 }, { label: 'W 1/2', us: '11.25', eu: '66.2', mm: 21.0 },
    { label: 'X 1/2', us: '11.75', eu: '67.5', mm: 21.4 }, { label: 'Z', us: '12.25', eu: '68.8', mm: 21.8 },
  ];
  const body = rows.map((r) => '<tr><td>' + r.label + '</td><td>' + r.us + '</td><td>' + r.eu + '</td><td>' + Number(r.mm).toFixed(1) + ' mm</td></tr>').join('');
  return '<div class="sm-tab-sizeguide"><p>Ring sizing — UK letter / US number / EU circumference / inner diameter. Measure the inner diameter or circumference of a ring that fits you.</p>' +
    '<table class="sm-size-guide-table"><thead><tr><th>UK Letter</th><th>US</th><th>EU (circ.)</th><th>Inner Diameter</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>' +
    '<p class="sm-fw-measure-note">If between sizes, choose the larger size for comfort.</p></div>';
}

function clothingSizeGuideHtml(p) {
  let sizes = (p.sizes && p.sizes.length) ? p.sizes.slice() : ['One Size'];
  if (p.variants && p.variants.length) {
    const vs = [];
    p.variants.forEach((v) => { if (v.size && vs.indexOf(v.size) === -1) vs.push(v.size); });
    if (vs.length) sizes = vs;
  }
  const rows = sizes.map((s) => {
    let chest = '-', waist = '-', length = '-';
    if (s === 'XS') { chest = 32; waist = 26; length = 24; }
    else if (s === 'S') { chest = 36; waist = 30; length = 26; }
    else if (s === 'M') { chest = 40; waist = 34; length = 28; }
    else if (s === 'L') { chest = 44; waist = 38; length = 30; }
    else if (s === 'XL') { chest = 48; waist = 42; length = 32; }
    else if (s === 'XXL') { chest = 52; waist = 46; length = 34; }
    else if (/^[2-5]T$/.test(s)) { const n = parseInt(s); chest = n * 2 + 16; waist = n * 2 + 14; length = n + 12; }
    else if (/^\d+$/.test(s)) { const n2 = parseInt(s); chest = n2 + 32; waist = n2 + 28; length = n2 + 24; }
    return '<tr><td>' + escHtml(s) + '</td><td>' + chest + '"</td><td>' + waist + '"</td><td>' + length + '"</td></tr>';
  }).join('');
  return '<div class="sm-tab-sizeguide"><p>All measurements are in inches.</p>' +
    '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Chest</th><th>Waist</th><th>Length</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

export function sizeGuideHtml(p) {
  if (p.size_guide) return '<div class="sm-tab-sizeguide"><p>' + escHtml(p.size_guide) + '</p></div>';
  const subcat = p.subcategory || (p.attributes && p.attributes.subcategory) || '';
  const subType = p.sub_type || (p.attributes && p.attributes.sub_type) || '';
  const isAccessoryType = p.category === 'accessories' || !!subcat;
  if (subcat === 'footwear' || (p.attributes && p.attributes.size_system === 'footwear')) return buildFootwearSizeGuideHtml(p);
  if (subcat === 'fashion_accessories' && subType === 'belts') return buildBeltSizeGuideHtml();
  if (subcat === 'fashion_accessories' && (subType === 'hats' || subType === 'caps' || subType === 'beanies')) return buildHatSizeGuideHtml();
  if (subcat === 'fashion_accessories' && subType === 'socks') return buildSocksSizeGuideHtml();
  if (subcat === 'jewellery' && subType === 'rings') return buildRingSizeGuideHtml();
  if (isAccessoryType) {
    return '<div class="sm-tab-sizeguide"><p>This product does not use a size chart. ' +
      'See the <strong>Specifications</strong> tab for full measurements and details.</p>' +
      '<p>If you are between sizes or unsure about fit, check the table on each product page — ' +
      'individual brands can vary from the standard guide.</p></div>';
  }
  return clothingSizeGuideHtml(p);
}

export function accessorySpecsHtml(p) {
  if (!p || p.category !== 'accessories') return '';
  const a = (p.attributes && typeof p.attributes === 'object') ? p.attributes : {};
  const subcat = p.subcategory || a.subcategory || '';
  const subType = p.sub_type || a.sub_type || '';
  const entries = [];
  function add(label, val) {
    if (val == null || val === '' || val === false) return;
    if (Array.isArray(val)) { if (!val.length) return; val = val.join(', '); }
    entries.push({ label, value: val });
  }
  const human = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (subcat === 'footwear') {
    add('Size System', a.size_system === 'footwear' ? 'Footwear (UK / EU / US / Length)' : (a.size_system || 'Footwear (UK / EU / US / Length)'));
    add('Available Sizes', p.sizes && p.sizes.length ? p.sizes.join(', ') : '');
    add('Upper Material', a.upper_material); add('Sole Material', a.sole_material);
    add('Heel Height', a.heel_height); add('Closure Type', a.closure_type);
    add('Fit', a.fit); add('Width / Fit options', a.width_fit);
    add('Style', a.style); add('Occasion', a.occasion);
    add('Waterproof', a.waterproof ? 'Yes' : ''); add('Material', p.material || a.material);
  } else if (subcat === 'bags') {
    add('Dimensions', a.dimensions); add('Capacity', a.capacity);
    add('Material', p.material || a.material); add('Strap Type', a.strap_type);
    add('Strap Length', a.strap_length); add('Compartments', a.compartments); add('Closure', a.closure);
  } else if (subcat === 'fashion_accessories' && subType === 'watches') {
    add('Case Size', a.case_size); add('Strap Material', a.strap_material);
    add('Dial Color', a.dial_color); add('Movement / Type', a.movement);
    add('Water Resistance', a.water_resistance); add('Strap Size', a.strap_size);
  } else if (subcat === 'fashion_accessories' && (subType === 'sunglasses' || subType === 'eyeglasses')) {
    add('Frame Color', a.frame_color); add('Lens Color', a.lens_color);
    add('Frame Material', a.frame_material); add('Lens Material', a.lens_material);
    add('UV Protection', a.uv_protection ? 'Yes' : ''); add('Frame Shape', a.frame_shape);
    add('Bridge Width', a.bridge_width); add('Lens Width', a.lens_width);
    add('Temple Length', a.temple_length); add('Prescription', a.prescription);
  } else if (subcat === 'jewellery') {
    add('Material', p.material || a.material); add('Finish', a.finish);
    add('Stone Type', a.stone_type); add('Ring Size', a.ring_size);
    add('Chain Length', a.chain_length); add('Bracelet Size', a.bracelet_size);
  } else if (subcat === 'fashion_accessories' && subType === 'belts') {
    add('Material', p.material || a.material); add('Waist Size', a.waist_size);
    add('Belt Length', a.belt_length); add('Buckle Type', a.buckle_type);
  } else if (subcat === 'fashion_accessories' && (subType === 'hats' || subType === 'caps' || subType === 'beanies')) {
    add('Size', a.size); add('Adjustable', a.adjustable ? 'Yes' : 'No');
    add('Circumference', a.circumference); add('Material', p.material || a.material);
  } else if (subcat === 'fashion_accessories' && subType === 'socks') {
    add('Size', a.size); add('UK / EU / US Size', a.size_system_detail);
    add('Material', p.material || a.material); add('Pack Quantity', a.pack_quantity);
  } else {
    add('Material', p.material || a.material);
    Object.keys(a).forEach((k) => {
      if (k === 'subcategory' || k === 'sub_type' || k === 'size_system') return;
      add(human(k), a[k]);
    });
  }
  if (!entries.length) return '';
  return '<div class="sm-pdp-specs"><dl class="sm-pdp-specs-list">' +
    entries.map((e) => '<dt>' + escHtml(e.label) + '</dt><dd>' + escHtml(String(e.value)) + '</dd>').join('') +
    '</dl></div>';
}

export function materialTabHtml(p) {
  const material = p.material || '';
  const fabric = p.fabric || '';
  const body = (material || fabric)
    ? '<p>' + (material ? escHtml(material) : '') + (material && fabric ? '<br>' : '') + (fabric ? escHtml(fabric) : '') + '</p>'
    : '<p>Material information not available.</p>';
  return '<div class="sm-tab-material">' + body +
    '<h4>Care Instructions</h4><ul><li>Machine wash cold with like colors</li><li>Tumble dry low</li>' +
    '<li>Do not bleach</li><li>Iron on low heat if needed</li><li>Do not dry clean</li></ul></div>';
}

export function deliveryReturnsTabHtml(p) {
  const deliveryInfo = p.delivery_info || '';
  const delivery = deliveryInfo
    ? '<div class="sm-tab-delivery"><p>' + escHtml(deliveryInfo) + '</p></div>'
    : '<div class="sm-tab-delivery"><h4>Delivery</h4><ul><li>Free standard delivery on orders over ₹1000</li>' +
      '<li>Standard delivery: 3-7 business days (₹50 flat)</li><li>Express delivery: 1-3 business days (₹150 flat)</li>' +
      '<li>Cash on delivery available for orders under ₹5000</li></ul></div>';
  const returnPolicy = p.return_policy || '';
  const returns = returnPolicy
    ? '<div class="sm-tab-return"><p>' + escHtml(returnPolicy) + '</p></div>'
    : '<div class="sm-tab-return"><h4>Returns & Exchanges</h4><ul><li>Easy 30-day return policy</li>' +
      '<li>Free returns for defective items</li><li>Items must be unworn with original tags attached</li>' +
      '<li>Refund processed within 5-7 business days</li><li>Exchange available for different size/color</li></ul></div>';
  return delivery + returns;
}
