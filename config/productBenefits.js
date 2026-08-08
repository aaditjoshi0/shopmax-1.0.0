// Global Product Benefits Configuration
// One source of truth for all product benefits across ShopMax.
// Add new benefits here — they automatically appear in admin forms
// and on customer-facing product pages.

const BENEFITS = [
  { id: 'free_delivery',   label: 'Free Delivery',       icon: 'icon-truck',       desc: 'Free delivery on this product', auto: 'free_delivery' },
  { id: 'cod',             label: 'Cash On Delivery',     icon: 'icon-money',       desc: 'Cash on delivery available' },
  { id: 'return_7',        label: '7 Days Return',        icon: 'icon-refresh',     desc: 'Easy returns within 7 days' },
  { id: 'return_10',       label: '10 Days Return',       icon: 'icon-refresh',     desc: 'Easy returns within 10 days' },
  { id: 'return_30',       label: '30 Days Return',       icon: 'icon-refresh',     desc: 'Easy returns within 30 days' },
  { id: 'exchange',        label: 'Exchange Available',   icon: 'icon-retweet',     desc: 'Exchange size or variant' },
  { id: 'secure_payment',  label: 'Secure Payment',       icon: 'icon-lock',        desc: '100% secure payment' },
  { id: 'top_brand',       label: 'Top Brand',            icon: 'icon-trophy',      desc: 'Premium quality brand' },
  { id: 'warranty',        label: 'Warranty Available',   icon: 'icon-shield',      desc: 'Manufacturer warranty included' },
  { id: 'fast_delivery',   label: 'Fast Delivery',        icon: 'icon-flash',       desc: 'Delivered within 1-2 business days', auto: 'fast_delivery' },
  { id: 'same_day',        label: 'Same Day Delivery',    icon: 'icon-plane',       desc: 'Same day delivery available', auto: 'same_day' },
  { id: 'official_store',  label: 'Official Store',       icon: 'icon-check-circle', desc: 'Official brand store product' },
  { id: 'sustainable',     label: 'Sustainable Product',  icon: 'icon-leaf',        desc: 'Eco-friendly sustainable product' },
  { id: 'customizable',    label: 'Customizable',         icon: 'icon-wrench',      desc: 'Customize this product' },
  { id: 'premium',         label: 'Premium Product',      icon: 'icon-diamond',     desc: 'Premium quality product' },
  { id: 'limited_stock',   label: 'Limited Stock',        icon: 'icon-warning',     desc: 'Limited stock available', auto: 'limited_stock' }
];

// Benefits with automatic behavior
function getAutoBenefits() {
  return BENEFITS.filter(b => b.auto);
}

// Render a single benefit badge HTML
function benefitBadgeHtml(benefit, extraClass) {
  return '<span class="sm-benefit-badge ' + (extraClass || '') + '" title="' + (benefit.desc || benefit.label) + '">' +
    '<span class="' + benefit.icon + '"></span> ' +
    benefit.label +
  '</span>';
}

// Render all benefit badges for a given array of benefit IDs
function renderBenefits(benefitIds, extraClass) {
  if (!benefitIds || !benefitIds.length) return '';
  return benefitIds.map(function (id) {
    var b = BENEFITS.find(function (x) { return x.id === id; });
    return b ? benefitBadgeHtml(b, extraClass) : '';
  }).join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BENEFITS, getAutoBenefits, benefitBadgeHtml, renderBenefits };
}