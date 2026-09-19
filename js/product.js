(function () {
  'use strict';
  var SM = window.ShopMax;

  var selectedSize = null;
  var selectedColor = null;
  var selectedVariant = null;
  var qty = 1;
  var currentProduct = null;
  var reviewData = null;
  var isWished = false;
  var ratingData = null;
  var _allColors = [];

  function $(id) { return document.getElementById(id); }

  function showError(msg) {
    var root = $('sm-product-root');
    if (!root) return;
    root.className = 'sm-empty';
    root.innerHTML = '<span class="icon icon-search"></span><h3>' + msg + '</h3><p><a href="/shop.html">Back to Shop</a></p>';
  }

  function init() {
    if (!SM) { showError('Website failed to load. Please refresh.'); return; }
    var m = window.location.pathname.match(/\/product\/(\d+)/);
    var id = m ? m[1] : SM.qs('id');
    if (!id) { showError('Product not found.'); return; }

    SM.api('/api/products/' + id).then(function (p) {
      if (!p || !p.id) { showError('Product not found.'); return; }
      currentProduct = p;
      trackRecentlyViewed(p);
      render(p);
      loadRatings(p.id);
      loadReviews(p.id);
      loadRelated(p);
      checkWishlist(p.id);
    }).catch(function () {
      showError('Unable to load product. Please try again.');
    });
  }

  function trackRecentlyViewed(p) {
    try {
      var items = JSON.parse(localStorage.getItem('sm_recently_viewed') || '[]');
      items = items.filter(function (i) { return i.id !== p.id; });
      items.unshift({ id: p.id, name: p.name, image_url: p.image_url, price: p.price, category: p.category });
      if (items.length > 12) items = items.slice(0, 12);
      localStorage.setItem('sm_recently_viewed', JSON.stringify(items));
    } catch (e) {}
  }

  function render(p) {
    var hasVariants = p.variants && p.variants.length > 0;
    var hasImages = p.images && p.images.length > 0;

    $('sm-crumb-cat').textContent = cap(p.category);
    $('sm-crumb-cat').href = '/' + (p.category === 'home' ? 'shop' : p.category) + '.html';
    $('sm-crumb-name').textContent = p.name;
    document.title = p.name + ' — ShopMax';

    var root = $('sm-product-root');
    root.classList.remove('sm-loading');
    root.className = 'row sm-pdp-main';

    var sizes = [];
    var colors = [];
    var colorObjects = [];

    if (hasVariants) {
      p.variants.forEach(function (v) {
        if (v.status !== 'published') return;
        if (v.size && sizes.indexOf(v.size) === -1) sizes.push(v.size);
      });
      if (sizes.length === 0) sizes = p.sizes || ['One Size'];
      colors = (p.colors && p.colors.length) ? p.colors : ['Default'];
    } else {
      colorObjects = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      colors = colorObjects;
      sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    }

    selectedSize = sizes[0] || 'One Size';
    selectedColor = colors[0] || 'Default';
    selectedVariant = hasVariants ? findVariant(p.variants, selectedSize, colorDisplay(selectedColor)) : null;
    _allColors = colors;

    var filteredImages = [];
    if (hasImages) {
      filteredImages = p.images.filter(function (img) {
        return !img.color || img.color === '' || img.color === colorDisplay(selectedColor);
      });
      if (filteredImages.length === 0) filteredImages = p.images;
    }

    var mainImgUrl = filteredImages.length > 0 ? filteredImages[0].url : (p.image_url || '');

    var galleryHtml = '';
    if (filteredImages.length > 1) {
      galleryHtml = '<div class="sm-pdp-thumbs" id="sm-pdp-thumbs">' +
        filteredImages.map(function (img, idx) {
          return '<button type="button" class="sm-pdp-thumb' + (idx === 0 ? ' active' : '') + '" data-url="' + SM.escapeHtml(img.url) + '" data-idx="' + idx + '">' +
            '<img src="' + SM.escapeHtml(img.url) + '" alt="' + SM.escapeHtml(img.alt || '') + '"></button>';
        }).join('') + '</div>';
    }

    var colorSwatchHtml = '';
    if (hasVariants) {
      colorSwatchHtml = colors.map(function (c, idx) {
        var name = colorDisplay(c);
        var hex = typeof c === 'object' ? c.hex : '#cccccc';
        return '<button type="button" class="sm-pdp-color' + (idx === 0 ? ' active' : '') + '" data-color="' + SM.escapeHtml(name) + '" title="' + SM.escapeHtml(name) + '">' +
          '<span class="sm-pdp-color-swatch" style="background:' + hex + '"></span>' +
          '<span class="sm-pdp-color-label">' + SM.escapeHtml(name) + '</span></button>';
      }).join('');
    } else {
      colorSwatchHtml = colors.map(function (c, idx) {
        var hex = typeof c === 'object' ? c.hex : '#cccccc';
        var name = typeof c === 'object' ? c.name : String(c);
        return '<button type="button" class="sm-pdp-color' + (idx === 0 ? ' active' : '') + '" data-idx="' + idx + '" title="' + SM.escapeHtml(name) + '">' +
          '<span class="sm-pdp-color-swatch" style="background:' + hex + '"></span>' +
          '<span class="sm-pdp-color-label">' + SM.escapeHtml(name) + '</span></button>';
      }).join('');
    }

    var sizeBtns = sizes.map(function (s, idx) {
      var stock = getVariantStock(p, s, colorDisplay(selectedColor));
      var oos = hasVariants && stock === 0;
      return '<button type="button" class="sm-pdp-size' + (idx === 0 ? ' active' : '') + (oos ? ' oos' : '') + '" data-size="' + SM.escapeHtml(s) + '"' + (oos ? ' title="Out of stock"' : '') + '>' + SM.escapeHtml(s) + '</button>';
    }).join('');

    var dp = selectedVariant ? selectedVariant.price : p.price;
    var dc = selectedVariant ? selectedVariant.compare_at_price : p.compare_at_price;
    var ds = selectedVariant ? selectedVariant.stock : p.stock;

    var discountPct = 0;
    if (dc && dc > dp) discountPct = Math.round(((dc - dp) / dc) * 100);

    var stockHtml = buildStockHtml(ds, hasVariants);
    var priceHtml = buildPriceHtml(dp, dc, discountPct);

    var tagsHtml = '';
    if (p.tags && p.tags.length) {
      tagsHtml = '<div class="sm-pdp-tags">' + p.tags.map(function (t) {
        return '<a href="/shop.html?q=' + encodeURIComponent(t) + '" class="sm-pdp-tag">' + SM.escapeHtml(t) + '</a>';
      }).join('') + '</div>';
    }

    var brandHtml = p.brand ? '<div class="sm-pdp-brand">' + SM.escapeHtml(p.brand) + '</div>' : '';
    var skuHtml = p.sku ? '<div class="sm-pdp-sku">SKU: ' + SM.escapeHtml(p.sku) + '</div>' : '';

    root.innerHTML =
      '<div class="col-lg-6 col-md-6 sm-pdp-gallery-col">' +
        '<div class="sm-pdp-main-img-wrap">' +
          '<div class="sm-pdp-main-img' + (ds === 0 ? ' oos' : '') + '" id="sm-pdp-zoom-wrap">' +
            '<img src="' + SM.escapeHtml(mainImgUrl) + '" alt="' + SM.escapeHtml(p.name) + '" id="sm-pdp-main-img" class="img-fluid">' +
            (ds === 0 ? '<div class="sm-pdp-oos-badge">OUT OF STOCK</div>' : '') +
          '</div>' +
        '</div>' +
        galleryHtml +
      '</div>' +
      '<div class="col-lg-6 col-md-6 sm-pdp-info-col">' +
        brandHtml +
        '<h1 class="sm-pdp-name">' + SM.escapeHtml(p.name) + '</h1>' +
        '<div class="sm-pdp-rating-row">' +
          '<div id="sm-pdp-rating-default" style="display:none">' + SM.ratingDisplayHtml(p.rating, p.rating_count || 0) + '</div>' +
          '<div id="sm-pdp-rating-loading">Loading ratings...</div>' +
          '<div id="sm-pdp-rating-display"></div>' +
          '<a href="#sm-reviews-section" class="sm-pdp-review-count" id="sm-pdp-review-link"> Reviews</a>' +
        '</div>' +
        priceHtml +
        stockHtml +
        (p.description ? '<p class="sm-pdp-desc">' + SM.escapeHtml(p.description) + '</p>' : '') +
        '<div class="sm-pdp-divider"></div>' +
        '<div class="sm-pdp-option">' +
          '<label class="sm-pdp-option-label">Color: <span id="sm-pdp-color-name">' + SM.escapeHtml(colorDisplay(selectedColor)) + '</span></label>' +
          '<div class="sm-pdp-colors" id="sm-pdp-colors">' + colorSwatchHtml + '</div>' +
        '</div>' +
        '<div class="sm-pdp-option">' +
          '<div class="sm-pdp-size-header">' +
            '<label class="sm-pdp-option-label">Size</label>' +
            '<a href="#" class="sm-pdp-size-guide-link" id="sm-size-guide-link">Size Guide</a>' +
          '</div>' +
          '<div class="sm-pdp-sizes" id="sm-pdp-sizes">' + sizeBtns + '</div>' +
        '</div>' +
        '<div class="sm-pdp-option">' +
          '<label class="sm-pdp-option-label">Quantity</label>' +
          '<div class="sm-pdp-qty">' +
            '<button type="button" class="sm-pdp-qty-btn" id="sm-qty-minus">-</button>' +
            '<span class="sm-pdp-qty-val" id="sm-qty-value">1</span>' +
            '<button type="button" class="sm-pdp-qty-btn" id="sm-qty-plus">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="sm-pdp-actions">' +
          '<div class="sm-pdp-action-main">' +
            '<button type="button" class="sm-pdp-addcart' + (ds === 0 ? ' oos' : '') + '" id="sm-add-cart"' + (ds === 0 ? ' disabled' : '') + '>' +
              (ds === 0 ? 'Out of Stock' : 'Add to Bag') +
            '</button>' +
            '<button type="button" class="sm-pdp-buynow' + (ds === 0 ? ' oos' : '') + '" id="sm-buy-now"' + (ds === 0 ? ' disabled' : '') + '>Buy Now</button>' +
          '</div>' +
          '<button type="button" class="sm-pdp-wishlist' + (isWished ? ' wished' : '') + '" id="sm-wishlist-btn" title="Add to Wishlist">' +
            '<span class="sm-pdp-wishlist-icon">' + (isWished ? '&#9829;' : '&#9825;') + '</span>' +
          '</button>' +
        '</div>' +
        tagsHtml +
        '<div class="sm-pdp-benefits" id="sm-pdp-benefits">' + SM.benefitBadgesHtml(p.benefits) + '</div>' +
        skuHtml +
      '</div>';

    $('sm-tabs-section').style.display = '';
    renderTabs(p);
    bindEvents(p);
  }

  function buildPriceHtml(price, compare, pct) {
    var html = '<div class="sm-pdp-price">';
    html += '<span class="sm-pdp-price-current">' + SM.money(price) + '</span>';
    if (compare && compare > price) {
      html += '<span class="sm-pdp-price-compare"><del>' + SM.money(compare) + '</del></span>';
      html += '<span class="sm-pdp-price-discount">-' + pct + '%</span>';
    }
    html += '</div>';
    return html;
  }

  function buildStockHtml(stock, hasVariants) {
    if (stock === 0) return '';
    if (stock <= 5) return '<div class="sm-pdp-stock low">Hurry! Only ' + stock + ' left in stock.</div>';
    return '<div class="sm-pdp-stock in">In Stock</div>';
  }

  function getVariantStock(p, size, color) {
    if (!p.variants) return p.stock || 0;
    var v = findVariant(p.variants, size, color);
    return v ? v.stock : 0;
  }

  function renderTabs(p) {
    var desc = p.description || '';
    var details = p.details || '';

    var material = p.material || '';
    var fabric = p.fabric || '';
    var materialContent = material || fabric
      ? '<p>' + (material ? SM.escapeHtml(material) : '') + (material && fabric ? '<br>' : '') + (fabric ? SM.escapeHtml(fabric) : '') + '</p>'
      : '<p>Material information not available.</p>';

    var deliveryInfo = p.delivery_info || '';
    var deliveryContent = deliveryInfo
      ? '<div class="sm-tab-delivery"><p>' + SM.escapeHtml(deliveryInfo) + '</p></div>'
      : '<div class="sm-tab-delivery">' +
        '<h4>Delivery</h4><ul><li>Free standard delivery on orders over \u20B91000</li><li>Standard delivery: 3-7 business days (\u20B950 flat)</li><li>Express delivery: 1-3 business days (\u20B9150 flat)</li><li>Cash on delivery available for orders under \u20B95000</li></ul>' +
        '</div>';

    var returnPolicy = p.return_policy || '';
    var returnContent = returnPolicy
      ? '<div class="sm-tab-return"><p>' + SM.escapeHtml(returnPolicy) + '</p></div>'
      : '<div class="sm-tab-return"><h4>Returns & Exchanges</h4><ul><li>Easy 30-day return policy</li><li>Free returns for defective items</li><li>Items must be unworn with original tags attached</li><li>Refund processed within 5-7 business days</li><li>Exchange available for different size/color</li></ul></div>';

    var sizeGuide = p.size_guide || '';
    var sizeGuideContent = sizeGuide
      ? '<div class="sm-tab-sizeguide"><p>' + SM.escapeHtml(sizeGuide) + '</p></div>'
      : buildSizeGuideHtml(p);

    var tabs = [
      { id: 'tab-desc', label: 'Description', content: '<div class="sm-tab-desc">' + (desc ? '<p>' + SM.escapeHtml(desc) + '</p>' : '<p>No description available.</p>') + (details ? '<p>' + SM.escapeHtml(details) + '</p>' : '') + '</div>' }
    ];

    // Accessory products get a Specifications tab right after Description,
    // populated from products.attributes (admin form writes type-specific fields).
    var specsHtml = buildAccessorySpecsHtml(p);
    if (specsHtml) {
      tabs.push({ id: 'tab-specs', label: 'Specifications', content: specsHtml });
    }

    tabs.push(
      { id: 'tab-material', label: 'Material & Care', content: '<div class="sm-tab-material">' + materialContent + '<h4>Care Instructions</h4><ul><li>Machine wash cold with like colors</li><li>Tumble dry low</li><li>Do not bleach</li><li>Iron on low heat if needed</li><li>Do not dry clean</li></ul></div>' },
      { id: 'tab-delivery', label: 'Delivery & Returns', content: deliveryContent + returnContent },
      { id: 'tab-sizeguide', label: 'Size Guide', content: sizeGuideContent }
    );

    var tabBtns = tabs.map(function (t, i) {
      return '<li><a href="#' + t.id + '" class="' + (i === 0 ? 'active' : '') + '" data-tab="' + t.id + '">' + t.label + '</a></li>';
    }).join('');

    var tabPanels = tabs.map(function (t, i) {
      return '<div class="sm-pdp-tab-panel' + (i === 0 ? ' active' : '') + '" id="' + t.id + '">' + t.content + '</div>';
    }).join('');

    $('sm-pdp-tabs').innerHTML = tabBtns;
    $('sm-pdp-tab-content').innerHTML = tabPanels;

    $('sm-pdp-tabs').addEventListener('click', function (e) {
      e.preventDefault();
      var link = e.target.closest('a[data-tab]');
      if (!link) return;
      var tabId = link.getAttribute('data-tab');
      $('sm-pdp-tabs').querySelectorAll('a').forEach(function (a) { a.classList.remove('active'); });
      link.classList.add('active');
      $('sm-pdp-tab-content').querySelectorAll('.sm-pdp-tab-panel').forEach(function (p) { p.classList.remove('active'); });
      var panel = $(tabId);
      if (panel) panel.classList.add('active');
    });
  }

  function buildSizeGuideHtml(p) {
    // Accessory products use category-aware size guides (footwear, belts, hats,
    // socks, rings).  Non-accessory products keep the existing clothing chart
    // (chest/waist/length for S/M/L/...) so existing pages are unchanged.
    var subcat = p.subcategory || (p.attributes && p.attributes.subcategory) || '';
    var subType = p.sub_type || (p.attributes && p.attributes.sub_type) || '';
    var isAccessoryType = p.category === 'accessories' || !!subcat;

    if (subcat === 'footwear' || (p.attributes && p.attributes.size_system === 'footwear')) {
      return buildFootwearSizeGuideHtml(p);
    }
    if (subcat === 'fashion_accessories' && (subType === 'belts')) {
      return buildBeltSizeGuideHtml(p);
    }
    if (subcat === 'fashion_accessories' && (subType === 'hats' || subType === 'caps' || subType === 'beanies')) {
      return buildHatSizeGuideHtml(p);
    }
    if (subcat === 'fashion_accessories' && subType === 'socks') {
      return buildSocksSizeGuideHtml(p);
    }
    if (subcat === 'jewellery' && subType === 'rings') {
      return buildRingSizeGuideHtml(p);
    }
    if (isAccessoryType) {
      // Accessory types without a chart (bags, watches, sung/eyeglasses,
      // necklaces/chains/pendants/bracelets/earrings/anklets, ties, scarves,
      // gloves, hair accessories, phone cases, keychains, travel/gift/small
      // accessories): no meaningful size guide — point users to Specs tab.
      return '<div class="sm-tab-sizeguide"><p>This product does not use a size chart. ' +
        'See the <strong>Specifications</strong> tab for full measurements and details.</p>' +
        '<p>If you are between sizes or unsure about fit, check the table on each product page — ' +
        'individual brands can vary from the standard guide.</p></div>';
    }
    // Default clothing chart (existing behaviour — kept verbatim).
    var sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    if (p.variants && p.variants.length) {
      var vs = [];
      p.variants.forEach(function (v) { if (v.size && vs.indexOf(v.size) === -1) vs.push(v.size); });
      if (vs.length) sizes = vs;
    }
    var rows = sizes.map(function (s) {
      var chest = '-', waist = '-', length = '-';
      if (s === 'XS') { chest = 32; waist = 26; length = 24; }
      else if (s === 'S') { chest = 36; waist = 30; length = 26; }
      else if (s === 'M') { chest = 40; waist = 34; length = 28; }
      else if (s === 'L') { chest = 44; waist = 38; length = 30; }
      else if (s === 'XL') { chest = 48; waist = 42; length = 32; }
      else if (s === 'XXL') { chest = 52; waist = 46; length = 34; }
      else if (/^[2-5]T$/.test(s)) { var n = parseInt(s); chest = n * 2 + 16; waist = n * 2 + 14; length = n + 12; }
      else if (/^\d+$/.test(s)) { var n2 = parseInt(s); chest = n2 + 32; waist = n2 + 28; length = n2 + 24; }
      return '<tr><td>' + SM.escapeHtml(s) + '</td><td>' + chest + '"</td><td>' + waist + '"</td><td>' + length + '"</td></tr>';
    }).join('');
    return '<div class="sm-tab-sizeguide"><p>All measurements are in inches.</p>' +
      '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Chest</th><th>Waist</th><th>Length</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // --------- FOOTWEAR SIZE GUIDE (Men's and Women's separately) ---------
  // Standard UK/EU/US/Foot Length (mm) conversions.  These are a GUIDE — actual
  // sizing varies by brand.  A product can override either chart via its
  // `attributes.footwear_chart_men` / `attributes.footwear_chart_women` arrays
  // (admin fills them when the brand's own chart differs from this default).
  var MENS_FOOTWEAR = [
    { uk:'5',    eu:'38.5', us:'6',    mm:235 },
    { uk:'5.5',  eu:'39',   us:'6.5',  mm:240 },
    { uk:'6',    eu:'39.5', us:'7',    mm:245 },
    { uk:'6.5',  eu:'40',   us:'7.5',  mm:250 },
    { uk:'7',    eu:'41',   us:'8',    mm:255 },
    { uk:'7.5',  eu:'42',   us:'8.5',  mm:260 },
    { uk:'8',    eu:'42.5', us:'9',    mm:265 },
    { uk:'8.5',  eu:'43',   us:'9.5',  mm:270 },
    { uk:'9',    eu:'44',   us:'10',   mm:275 },
    { uk:'9.5',  eu:'44.5', us:'10.5', mm:280 },
    { uk:'10',   eu:'45',   us:'11',   mm:285 },
    { uk:'10.5', eu:'45.5', us:'11.5', mm:290 },
    { uk:'11',   eu:'46',   us:'12',   mm:295 },
    { uk:'11.5', eu:'46.5', us:'12.5', mm:300 },
    { uk:'12',   eu:'47',   us:'13',   mm:305 },
    { uk:'13',   eu:'48',   us:'14',   mm:315 }
  ];
  var WOMENS_FOOTWEAR = [
    { uk:'2',    eu:'35',   us:'4',    mm:210 },
    { uk:'2.5',  eu:'35.5', us:'4.5',  mm:214 },
    { uk:'3',    eu:'36',   us:'5',    mm:220 },
    { uk:'3.5',  eu:'37',   us:'5.5',  mm:225 },
    { uk:'4',    eu:'37.5', us:'6',    mm:230 },
    { uk:'4.5',  eu:'38',   us:'6.5',  mm:235 },
    { uk:'5',    eu:'38.5', us:'7',    mm:238 },
    { uk:'5.5',  eu:'39',   us:'7.5',  mm:245 },
    { uk:'6',    eu:'39.5', us:'8',    mm:250 },
    { uk:'6.5',  eu:'40',   us:'8.5',  mm:255 },
    { uk:'7',    eu:'41',   us:'9',    mm:260 },
    { uk:'7.5',  eu:'42',   us:'9.5',  mm:265 },
    { uk:'8',    eu:'42.5', us:'10',   mm:270 },
    { uk:'8.5',  eu:'43',   us:'10.5', mm:275 },
    { uk:'9',    eu:'44',   us:'11',   mm:280 }
  ];
  var WIDTH_FIT_OPTIONS = ['Standard', 'Wide', 'Extra Wide'];
  // Tip shown under both footwear tables — measurement instructions + guidance.
  var FOOTWEAR_MEASURE_TIP =
    '<h4 class="sm-fw-measure-title">How to Measure Your Foot</h4>' +
    '<ol class="sm-fw-measure-steps">' +
      '<li>Place a sheet of A4 paper flat against a wall, long edge touching it.</li>' +
      '<li>Stand on the paper with your heel touching the wall. Wear the socks you will use.</li>' +
      '<li>Mark the tip of your longest toe on the paper.</li>' +
      '<li>Measure the distance from the wall to the mark in millimetres — that is your foot length.</li>' +
      '<li>Buy the chart size whose foot length is equal to or just greater than yours.</li>' +
    '</ol>' +
    '<div class="sm-fw-measure-note">' +
      '<strong>If between sizes:</strong> check the product / brand\'s own size chart when available — sizing varies by brand and lasts vary by maker. ' +
      'For wide feet, choose <em>Wide</em> or <em>Extra Wide</em> options where the product offers them.' +
    '</div>';

  function footwearTableHtml(chart) {
    var body = chart.map(function (r) {
      return '<tr><td class="sm-fw-size">' + SM.escapeHtml(r.uk) + '</td><td>' + SM.escapeHtml(r.eu) + '</td><td>' +
        SM.escapeHtml(r.us) + '</td><td>' + Number(r.mm) + ' mm (' + (Number(r.mm) / 10).toFixed(1) + ' cm)</td></tr>';
    }).join('');
    return '<table class="sm-size-guide-table sm-fw-table"><thead>' +
        '<tr><th>UK</th><th>EU</th><th>US</th><th>Foot Length</th></tr>' +
      '</thead><tbody>' + body + '</tbody></table>';
  }

  function buildFootwearSizeGuideHtml(p) {
    var gender = (p.gender || 'unisex').toLowerCase();
    var menChart = (p.attributes && (p.attributes.footwear_chart_men || p.attributes.chart_men)) || MENS_FOOTWEAR;
    var womenChart = (p.attributes && (p.attributes.footwear_chart_women || p.attributes.chart_women)) || WOMENS_FOOTWEAR;
    var widthFit = (p.attributes && p.attributes.width_fit) || null;

    var html = '<div class="sm-tab-sizeguide sm-fw-sizeguide">' +
      '<p class="sm-fw-intro">Footwear sizing — a guide only. Sizes and fits vary by brand, last shape and model. ' +
      'Always check the brand\'s own size chart on the product page when available.</p>';

    // Show both tables; mark the relevant one for the product's gender as
    // "default" but keep both visible so unisex customers can use either.
    var menActive = (gender === 'men' || gender === 'unisex') ? ' sm-fw-active' : '';
    var womenActive = (gender === 'women') ? ' sm-fw-active' : '';
    html += '<div class="sm-fw-tables">' +
        '<div class="sm-fw-block' + menActive + '">' +
          '<h4 class="sm-fw-block-title">Men\'s Footwear</h4>' +
          footwearTableHtml(menChart) +
        '</div>' +
        '<div class="sm-fw-block' + womenActive + '">' +
          '<h4 class="sm-fw-block-title">Women\'s Footwear</h4>' +
          footwearTableHtml(womenChart) +
        '</div>' +
      '</div>';

    if (widthFit && widthFit.length) {
      html += '<div class="sm-fw-width">' +
        '<h4 class="sm-fw-width-title">Width / Fit options on this product</h4>' +
        '<div class="sm-fw-width-list">' + widthFit.map(function (w) { return '<span class="sm-fw-width-chip">' + SM.escapeHtml(w) + '</span>'; }).join('') + '</div>' +
      '</div>';
    } else {
      html += '<div class="sm-fw-width sm-fw-width-generic">' +
        '<strong>Width / Fit:</strong> where available, options are <em>Standard</em>, <em>Wide</em> and <em>Extra Wide</em>. ' +
        'Not all products offer every width — select at variant level.' +
      '</div>';
    }

    html += FOOTWEAR_MEASURE_TIP + '</div>';
    return html;
  }

  // --------- BELT SIZE GUIDE ---------
  function buildBeltSizeGuideHtml() {
    var rows = [
      { size:'S',  waist:28, belt:32 },
      { size:'M',  waist:32, belt:36 },
      { size:'L',  waist:36, belt:40 },
      { size:'XL', waist:40, belt:44 },
      { size:'XXL',waist:44, belt:48 }
    ];
    var body = rows.map(function (r) {
      return '<tr><td>' + r.size + '</td><td>' + r.waist + '"</td><td>' + r.belt + '"</td></tr>';
    }).join('');
    return '<div class="sm-tab-sizeguide"><p>Belt length is measured from the buckle prong to the middle hole.</p>' +
      '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Waist (inch)</th><th>Belt Length (inch)</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '<p class="sm-fw-measure-note">If between sizes, size up — belts sit better at the middle hole.</p></div>';
  }

  // --------- HAT / CAP / BEANIE SIZE GUIDE ---------
  function buildHatSizeGuideHtml() {
    var rows = [
      { size:'S/M',  head_inch:21.5, head_cm:55 },
      { size:'M/L',  head_inch:22.5, head_cm:57 },
      { size:'L/XL', head_inch:23.5, head_cm:60 },
      { size:'One Size', head_inch:'Adjustable', head_cm:'Adjustable' }
    ];
    var body = rows.map(function (r) {
      return '<tr><td>' + r.size + '</td><td>' + r.head_inch + '</td><td>' + r.head_cm + '</td></tr>';
    }).join('');
    return '<div class="sm-tab-sizeguide"><p>Measure around the widest part of your head (above the ears and eyebrows).</p>' +
      '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Head Circumference (inch)</th><th>Head Circumference (cm)</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  // --------- SOCKS SIZE GUIDE ---------
  function buildSocksSizeGuideHtml() {
    var rows = [
      { size:'S',   uk_shoe:'3-5',  eu:'35-38', us:'4-6'  },
      { size:'M',   uk_shoe:'6-8',  eu:'39-42', us:'7-9'  },
      { size:'L',   uk_shoe:'9-11', eu:'43-46', us:'10-12'},
      { size:'XL',  uk_shoe:'12-14',eu:'47-49', us:'13-15'}
    ];
    var body = rows.map(function (r) {
      return '<tr><td>' + r.size + '</td><td>UK ' + r.uk_shoe + '</td><td>EU ' + r.eu + '</td><td>US ' + r.us + '</td></tr>';
    }).join('');
    return '<div class="sm-tab-sizeguide"><p>Socks sizing by UK / EU / US shoe size.</p>' +
      '<table class="sm-size-guide-table"><thead><tr><th>Sock Size</th><th>UK Shoe</th><th>EU Shoe</th><th>US Shoe</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  // --------- RING SIZE GUIDE (jewellery) ---------
  function buildRingSizeGuideHtml() {
    var rows = [
      { label:'H 1/2', uk:'H',   eu:'46.8', us:'3.75', mm:14.9 },
      { label:'I 1/2', uk:'I',   eu:'48.0', us:'4.25', mm:15.3 },
      { label:'J 1/2', uk:'J',   eu:'49.3', us:'4.75', mm:15.7 },
      { label:'K 1/2', uk:'K',   eu:'50.6', us:'5.25', mm:16.1 },
      { label:'L 1/2', uk:'L',   eu:'51.9', us:'5.75', mm:16.5 },
      { label:'M 1/2', uk:'M',   eu:'53.2', us:'6.25', mm:16.9 },
      { label:'N 1/2', uk:'N',   eu:'54.5', us:'6.75', mm:17.3 },
      { label:'O 1/2', uk:'O',   eu:'55.8', us:'7.25', mm:17.7 },
      { label:'P 1/2', uk:'P',   eu:'57.1', us:'7.75', mm:18.1 },
      { label:'Q 1/2', uk:'Q',   eu:'58.4', us:'8.25', mm:18.5 },
      { label:'R 1/2', uk:'R',   eu:'59.7', us:'8.75', mm:19.0 },
      { label:'S 1/2', uk:'S',   eu:'61.0', us:'9.25', mm:19.4 },
      { label:'T 1/2', uk:'T',   eu:'62.3', us:'9.75', mm:19.8 },
      { label:'U 1/2', uk:'U',   eu:'63.6', us:'10.25',mm:20.2 },
      { label:'V 1/2', uk:'V',   eu:'64.9', us:'10.75',mm:20.6 },
      { label:'W 1/2', uk:'W',   eu:'66.2', us:'11.25',mm:21.0 },
      { label:'X 1/2', uk:'X',   eu:'67.5', us:'11.75',mm:21.4 },
      { label:'Z',     uk:'Z',   eu:'68.8', us:'12.25',mm:21.8 }
    ];
    var body = rows.map(function (r) {
      return '<tr><td>' + r.label + '</td><td>' + r.us + '</td><td>' + r.eu + '</td><td>' + Number(r.mm).toFixed(1) + ' mm</td></tr>';
    }).join('');
    return '<div class="sm-tab-sizeguide"><p>Ring sizing — UK letter / US number / EU circumference / inner diameter. Measure the inner diameter or circumference of a ring that fits you.</p>' +
      '<table class="sm-size-guide-table"><thead><tr><th>UK Letter</th><th>US</th><th>EU (circ.)</th><th>Inner Diameter</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '<p class="sm-fw-measure-note">If between sizes, choose the larger size for comfort.</p></div>';
  }

  // --------- ACCESSORY SPECIFICATIONS PANEL ---------
  // Renders a definition-list of type-specific attributes pulled from
  // products.attributes (the admin form writes these).  Returns '' when the
  // product has no accessory specs so the Specifications tab is not added.
  function buildAccessorySpecsHtml(p) {
    if (!p || p.category !== 'accessories') return '';
    var a = (p.attributes && typeof p.attributes === 'object') ? p.attributes : {};
    var subcat = p.subcategory || a.subcategory || '';
    var subType = p.sub_type || a.sub_type || '';
    var entries = [];
    function add(label, val) {
      if (val == null || val === '' || val === false) return;
      if (Array.isArray(val)) {
        if (!val.length) return;
        val = val.join(', ');
      }
      entries.push({ label: label, value: val });
    }

    if (subcat === 'footwear') {
      add('Size System', a.size_system === 'footwear' ? 'Footwear (UK / EU / US / Length)' : (a.size_system || 'Footwear (UK / EU / US / Length)'));
      add('Available Sizes', p.sizes && p.sizes.length ? p.sizes.join(', ') : '');
      add('Upper Material', a.upper_material);
      add('Sole Material', a.sole_material);
      add('Heel Height', a.heel_height);
      add('Closure Type', a.closure_type);
      add('Fit', a.fit);
      add('Width / Fit options', a.width_fit);
      add('Style', a.style);
      add('Occasion', a.occasion);
      add('Waterproof', a.waterproof ? 'Yes' : '');
      add('Material', p.material || a.material);
    } else if (subcat === 'bags') {
      add('Dimensions', a.dimensions);
      add('Capacity', a.capacity);
      add('Material', p.material || a.material);
      add('Strap Type', a.strap_type);
      add('Strap Length', a.strap_length);
      add('Compartments', a.compartments);
      add('Closure', a.closure);
    } else if (subcat === 'fashion_accessories' && (subType === 'watches')) {
      add('Case Size', a.case_size);
      add('Strap Material', a.strap_material);
      add('Dial Color', a.dial_color);
      add('Movement / Type', a.movement);
      add('Water Resistance', a.water_resistance);
      add('Strap Size', a.strap_size);
    } else if (subcat === 'fashion_accessories' && (subType === 'sunglasses' || subType === 'eyeglasses')) {
      add('Frame Color', a.frame_color);
      add('Lens Color', a.lens_color);
      add('Frame Material', a.frame_material);
      add('Lens Material', a.lens_material);
      add('UV Protection', a.uv_protection ? 'Yes' : '');
      add('Frame Shape', a.frame_shape);
      add('Bridge Width', a.bridge_width);
      add('Lens Width', a.lens_width);
      add('Temple Length', a.temple_length);
      add('Prescription', a.prescription);
    } else if (subcat === 'jewellery') {
      add('Material', p.material || a.material);
      add('Finish', a.finish);
      add('Stone Type', a.stone_type);
      add('Ring Size', a.ring_size);
      add('Chain Length', a.chain_length);
      add('Bracelet Size', a.bracelet_size);
    } else if (subcat === 'fashion_accessories' && subType === 'belts') {
      add('Material', p.material || a.material);
      add('Waist Size', a.waist_size);
      add('Belt Length', a.belt_length);
      add('Buckle Type', a.buckle_type);
    } else if (subcat === 'fashion_accessories' && (subType === 'hats' || subType === 'caps' || subType === 'beanies')) {
      add('Size', a.size);
      add('Adjustable', a.adjustable ? 'Yes' : 'No');
      add('Circumference', a.circumference);
      add('Material', p.material || a.material);
    } else if (subcat === 'fashion_accessories' && subType === 'socks') {
      add('Size', a.size);
      add('UK / EU / US Size', a.size_system_detail);
      add('Material', p.material || a.material);
      add('Pack Quantity', a.pack_quantity);
    } else {
      // Generic accessory or unknown sub-type — show whatever attributes exist.
      add('Material', p.material || a.material);
      Object.keys(a).forEach(function (k) {
        if (k === 'subcategory' || k === 'sub_type' || k === 'size_system') return;
        var v = a[k];
        if (v == null || v === '' || v === false) return;
        if (Array.isArray(v)) { if (!v.length) return; v = v.join(', '); }
        // human-readable label
        add(k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }), v);
      });
    }

    if (!entries.length) return '';
    var rows = entries.map(function (e) {
      return '<dt>' + SM.escapeHtml(e.label) + '</dt><dd>' + SM.escapeHtml(String(e.value)) + '</dd>';
    }).join('');
    return '<div class="sm-pdp-specs"><dl class="sm-pdp-specs-list">' + rows + '</dl></div>';
  }

  function updateVariantUI(p) {
    var hasVariants = p.variants && p.variants.length > 0;
    var v = selectedVariant;
    var dp = v ? v.price : p.price;
    var dc = v ? v.compare_at_price : p.compare_at_price;
    var ds = v ? v.stock : p.stock;
    var pct = 0;
    if (dc && dc > dp) pct = Math.round(((dc - dp) / dc) * 100);

    var priceWrap = document.querySelector('.sm-pdp-price');
    if (priceWrap) priceWrap.outerHTML = buildPriceHtml(dp, dc, pct);

    var stockWrap = document.querySelector('.sm-pdp-stock');
    var newStock = buildStockHtml(ds, hasVariants);
    if (stockWrap) {
      if (newStock) { stockWrap.outerHTML = newStock; }
      else { stockWrap.remove(); }
    } else if (newStock) {
      var desc = document.querySelector('.sm-pdp-desc');
      if (desc) desc.insertAdjacentHTML('afterend', newStock);
    }

    var addBtn = $('sm-add-cart');
    var buyBtn = $('sm-buy-now');
    if (addBtn) {
      if (ds === 0) { addBtn.disabled = true; addBtn.textContent = 'Out of Stock'; addBtn.classList.add('oos'); }
      else { addBtn.disabled = false; addBtn.textContent = 'Add to Bag'; addBtn.classList.remove('oos'); }
    }
    if (buyBtn) {
      if (ds === 0) { buyBtn.disabled = true; buyBtn.classList.add('oos'); }
      else { buyBtn.disabled = false; buyBtn.classList.remove('oos'); }
    }

    qty = 1;
    var qtyEl = $('sm-qty-value');
    if (qtyEl) qtyEl.textContent = 1;

    // Update size buttons stock state
    if (hasVariants) {
      var sizeRow = $('sm-pdp-sizes');
      if (sizeRow) {
        sizeRow.querySelectorAll('.sm-pdp-size').forEach(function (btn) {
          var s = btn.getAttribute('data-size');
          var stock = getVariantStock(p, s, colorDisplay(selectedColor));
          if (stock === 0) { btn.classList.add('oos'); btn.title = 'Out of stock'; }
          else { btn.classList.remove('oos'); btn.title = ''; }
        });
      }
    }
  }

  function colorDisplay(c) { return typeof c === 'object' ? c.name : String(c); }

  function findVariant(variants, size, color) {
    return variants.find(function (v) {
      return v.status === 'published' && v.size === size && v.color === color;
    }) || variants.find(function (v) {
      return v.status === 'published' && v.size === size;
    }) || variants.find(function (v) {
      return v.status === 'published' && v.color === color;
    }) || null;
  }

  function bindEvents(p) {
    var hasVariants = p.variants && p.variants.length > 0;
    var hasImages = p.images && p.images.length > 0;

    // Image gallery click
    var thumbsWrap = $('sm-pdp-thumbs');
    if (thumbsWrap) {
      thumbsWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-pdp-thumb');
        if (!btn) return;
        var url = btn.getAttribute('data-url');
        var img = $('sm-pdp-main-img');
        if (img) img.src = url;
        thumbsWrap.querySelectorAll('.sm-pdp-thumb').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    }

    // Image zoom
    var zoomWrap = $('sm-pdp-zoom-wrap');
    if (zoomWrap) {
      zoomWrap.addEventListener('mousemove', function (e) {
        var img = $('sm-pdp-main-img');
        if (!img) return;
        var rect = zoomWrap.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width * 100;
        var y = (e.clientY - rect.top) / rect.height * 100;
        img.style.transformOrigin = x + '% ' + y + '%';
        img.style.transform = 'scale(2)';
      });
      zoomWrap.addEventListener('mouseleave', function () {
        var img = $('sm-pdp-main-img');
        if (img) { img.style.transformOrigin = 'center center'; img.style.transform = 'scale(1)'; }
      });
    }

    // Color selection
    var colorWrap = $('sm-pdp-colors');
    if (colorWrap) {
      colorWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-pdp-color');
        if (!btn) return;
        colorWrap.querySelectorAll('.sm-pdp-color').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        if (hasVariants) {
          selectedColor = btn.getAttribute('data-color');
        } else {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          selectedColor = _allColors[idx];
        }
        var cname = colorDisplay(selectedColor);
        // Update selected color text
        var nameEl = $('sm-pdp-color-name');
        if (nameEl) nameEl.textContent = cname;

        // Update images — filter by color, fall back to all images if none match
        if (hasImages) {
          var filtered = p.images.filter(function (img) { return !img.color || img.color === '' || img.color === cname; });
          if (filtered.length === 0) filtered = p.images;
          var mainImg = $('sm-pdp-main-img');
          if (mainImg && filtered.length > 0) mainImg.src = filtered[0].url;
          var tw = $('sm-pdp-thumbs');
          if (tw) {
            if (filtered.length > 1) {
              tw.innerHTML = filtered.map(function (img, i2) {
                return '<button type="button" class="sm-pdp-thumb' + (i2 === 0 ? ' active' : '') + '" data-url="' + SM.escapeHtml(img.url) + '"><img src="' + SM.escapeHtml(img.url) + '" alt=""></button>';
              }).join('');
            } else {
              tw.innerHTML = '';
            }
          }
        }

        if (hasVariants) {
          // Find available sizes for this color
          var availSizes = [];
          p.variants.forEach(function (v) {
            if (v.status === 'published' && v.color === cname && v.size && availSizes.indexOf(v.size) === -1) {
              availSizes.push(v.size);
            }
          });
          // Reset selected size if current one isn't available for this color
          if (availSizes.length > 0 && availSizes.indexOf(selectedSize) === -1) {
            selectedSize = availSizes[0];
            var sizeRow = $('sm-pdp-sizes');
            if (sizeRow) {
              sizeRow.querySelectorAll('.sm-pdp-size').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-size') === selectedSize);
              });
            }
          }
          selectedVariant = findVariant(p.variants, selectedSize, cname);
          updateVariantUI(p);
        }
      });
    }

    // Size selection
    var sizeRow = $('sm-pdp-sizes');
    if (sizeRow) {
      sizeRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-pdp-size');
        if (!btn || btn.classList.contains('oos')) return;
        sizeRow.querySelectorAll('.sm-pdp-size').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedSize = btn.getAttribute('data-size');
        if (hasVariants) {
          selectedVariant = findVariant(p.variants, selectedSize, colorDisplay(selectedColor));
          updateVariantUI(p);
        }
      });
    }

    // Quantity
    var minusBtn = $('sm-qty-minus');
    var plusBtn = $('sm-qty-plus');
    var qtyEl = $('sm-qty-value');
    if (minusBtn) minusBtn.addEventListener('click', function () { qty = Math.max(1, qty - 1); if (qtyEl) qtyEl.textContent = qty; });
    if (plusBtn) plusBtn.addEventListener('click', function () {
      var max = selectedVariant ? selectedVariant.stock : p.stock;
      qty = Math.min(max || 999, qty + 1);
      if (qtyEl) qtyEl.textContent = qty;
    });

    // Add to Cart
    var cartBtn = $('sm-add-cart');
    if (cartBtn) {
      cartBtn.addEventListener('click', function () {
        var cname = colorDisplay(selectedColor);
        var price = selectedVariant ? selectedVariant.price : p.price;
        var imgUrl = p.image_url;
        if (hasImages) {
          var filtered = p.images.filter(function (img) { return !img.color || img.color === '' || img.color === cname; });
          imgUrl = filtered.length > 0 ? filtered[0].url : p.image_url;
        }

        SM.addToCart({
          product_id: p.id,
          variant_id: selectedVariant ? selectedVariant.id : null,
          name: p.name,
          price: price,
          image_url: imgUrl,
          size: selectedSize,
          quantity: qty,
          color: cname
        }).then(function () {
          SM.toast('Added ' + qty + ' \u00D7 ' + p.name + ' to bag');
          cartBtn.textContent = '\u2713 Added!';
          cartBtn.classList.add('sm-added');
          setTimeout(function () { cartBtn.textContent = 'Add to Bag'; cartBtn.classList.remove('sm-added'); }, 1500);
        }).catch(function (err) { SM.toast(err.message || 'Failed to add to cart', 'error'); });
      });
    }

    // Buy Now
    var buyBtn = $('sm-buy-now');
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        var cname = colorDisplay(selectedColor);
        var price = selectedVariant ? selectedVariant.price : p.price;
        var imgUrl = p.image_url;
        if (hasImages) {
          var filtered = p.images.filter(function (img) { return !img.color || img.color === '' || img.color === cname; });
          imgUrl = filtered.length > 0 ? filtered[0].url : p.image_url;
        }

        SM.addToCart({
          product_id: p.id,
          variant_id: selectedVariant ? selectedVariant.id : null,
          name: p.name,
          price: price,
          image_url: imgUrl,
          size: selectedSize,
          quantity: qty,
          color: cname
        }).then(function () {
          window.location.href = '/checkout.html';
        }).catch(function (err) { SM.toast(err.message || 'Failed to add to cart', 'error'); });
      });
    }

    // Wishlist
    var wishBtn = $('sm-wishlist-btn');
    if (wishBtn) {
      wishBtn.addEventListener('click', function () {
        if (!SM.isLoggedIn()) { SM.requireLogin(); return; }
        toggleWishlist(p.id);
      });
    }

    // Size Guide (inline modal)
    var guideLink = $('sm-size-guide-link');
    if (guideLink) {
      guideLink.addEventListener('click', function (e) {
        e.preventDefault();
        var sizeTab = document.querySelector('[data-tab="tab-sizeguide"]');
        if (sizeTab) sizeTab.click();
        $('sm-tabs-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Review link scroll
    var reviewLink = $('sm-pdp-review-link');
    if (reviewLink) {
      reviewLink.addEventListener('click', function (e) {
        e.preventDefault();
        $('sm-reviews-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function loadRatings(productId) {
    SM.api('/api/ratings/product/' + productId).then(function (data) {
      ratingData = data;
      renderRatings(productId);
    }).catch(function () {
      var displayEl = $('sm-pdp-rating-display');
      var loadingEl = $('sm-pdp-rating-loading');
      var defaultEl = $('sm-pdp-rating-default');
      if (loadingEl) loadingEl.style.display = 'none';
      if (defaultEl) defaultEl.style.display = 'none';
      if (displayEl) displayEl.innerHTML = '<div class="sm-rating-error">Ratings are temporarily unavailable.</div>';
    });
  }

  function renderRatings(productId) {
    if (!ratingData) return;
    var displayEl = $('sm-pdp-rating-display');
    var loadingEl = $('sm-pdp-rating-loading');
    var defaultEl = $('sm-pdp-rating-default');
    if (loadingEl) loadingEl.style.display = 'none';
    if (defaultEl) defaultEl.style.display = 'none';
    if (!displayEl) return;

    var avg = ratingData.average || 0;
    var count = ratingData.count || 0;
    var userRating = ratingData.userRating || 0;

    var html = '<div class="sm-pdp-rating-section">';

    if (count === 0) {
      html += '<div class="sm-rating-display"><span class="sm-rating-stars"><span class="icon-star2 text-muted"></span><span class="icon-star2 text-muted"></span><span class="icon-star2 text-muted"></span><span class="icon-star2 text-muted"></span><span class="icon-star2 text-muted"></span></span></div>';
      html += '<div class="sm-no-ratings-text">No Ratings Yet</div>';
      if (SM.isLoggedIn()) {
        html += '<div class="sm-no-ratings-sub">Be the first to rate this product.</div>';
        html += '<div class="sm-pdp-rate-this">' +
          '<div class="sm-rating-interactive" id="sm-rating-interactive">' +
            SM.ratingInputHtml(0) +
          '</div>' +
        '</div>';
      } else {
        html += '<div class="sm-no-ratings-sub">Please sign in to rate this product.</div>';
      }
    } else {
      html += '<div class="sm-pdp-rating-summary">' + SM.ratingDisplayHtml(avg, count) + '</div>';
      if (SM.isLoggedIn()) {
        html += '<div class="sm-pdp-rate-this">' +
          '<label class="sm-rate-label">Rate this Product:</label>' +
          '<div class="sm-rating-interactive" id="sm-rating-interactive">' +
            SM.ratingInputHtml(userRating) +
          '</div>' +
        '</div>';
      } else {
        html += '<div class="sm-pdp-rate-login"><a href="/login.html?next=' + encodeURIComponent(window.location.pathname) + '">Sign in</a> to rate this product.</div>';
      }
    }

    html += '</div>';
    displayEl.innerHTML = html;

    if (SM.isLoggedIn()) {
      bindRatingInput(productId);
    }
  }

  function bindRatingInput(productId) {
    var container = $('sm-rating-interactive');
    if (!container) return;
    container.addEventListener('click', function (e) {
      var star = e.target.closest('.sm-rating-star');
      if (!star) return;
      var val = parseInt(star.getAttribute('data-val'), 10);
      if (!val) return;
      // highlight clicked star and all before it
      container.querySelectorAll('.sm-rating-star').forEach(function (s) {
        var v = parseInt(s.getAttribute('data-val'), 10);
        s.classList.toggle('active', v <= val);
      });
      // submit rating
      SM.api('/api/ratings', {
        method: 'POST',
        body: JSON.stringify({ target_type: 'product', target_id: productId, rating: val })
      }).then(function (data) {
        ratingData = data;
        renderRatings(productId);
      }).catch(function (err) {
        SM.toast(err.message || 'Failed to save rating', 'error');
      });
    });
  }

  function loadReviews(productId) {
    SM.api('/api/reviews?product_id=' + productId).then(function (data) {
      reviewData = data;
      renderReviews(productId);
    }).catch(function () {});
  }

  function renderReviews(productId) {
    if (!reviewData) return;
    var section = $('sm-reviews-section');
    if (!section) return;
    section.style.display = '';

    var avg = reviewData.average || 0;
    var count = reviewData.count || 0;
    var stars = SM.starHtml(avg);

    $('sm-reviews-summary').innerHTML =
      '<div class="sm-reviews-summary">' +
        '<div class="sm-reviews-avg">' +
          '<span class="sm-reviews-avg-num">' + avg.toFixed(1) + '</span>' +
          '<div class="sm-reviews-avg-stars">' + stars + '</div>' +
          '<span class="sm-reviews-avg-count">' + count + ' review' + (count !== 1 ? 's' : '') + '</span>' +
        '</div>' +
      '</div>';

    var reviewsHtml = reviewData.reviews.map(function (r) {
      return '<div class="sm-review-item">' +
        '<div class="sm-review-header">' +
          '<div class="sm-review-stars">' + SM.starHtml(r.rating) + '</div>' +
          '<span class="sm-review-author">' + SM.escapeHtml(r.user_name || 'Anonymous') + '</span>' +
          (r.verified_purchase ? '<span class="sm-review-verified">Verified Purchase</span>' : '') +
          '<span class="sm-review-date">' + new Date(r.created_at).toLocaleDateString() + '</span>' +
        '</div>' +
        (r.title ? '<div class="sm-review-title">' + SM.escapeHtml(r.title) + '</div>' : '') +
        ((r.review) ? '<div class="sm-review-body">' + SM.escapeHtml(r.review) + '</div>' : '') +
      '</div>';
    }).join('');

    $('sm-reviews-list').innerHTML = reviewsHtml || '<p class="text-muted">No reviews yet. Be the first to review this product!</p>';

    var formWrap = $('sm-review-form-wrap');
    if (!formWrap) return;

    if (SM.isLoggedIn()) {
      formWrap.innerHTML = '<p class="text-muted">Checking your eligibility...</p>';
      SM.api('/api/reviews/eligible?product_id=' + productId).then(function (elig) {
        if (elig.alreadyReviewed) {
          formWrap.innerHTML = '<p class="text-muted">You have already reviewed this product.</p>';
          return;
        }
        if (!elig.purchaseEligible) {
          formWrap.innerHTML = '<p class="text-muted">You can review this product after it has been delivered to you.</p>';
          return;
        }
        formWrap.innerHTML =
          '<div class="sm-review-form-wrap">' +
            '<h4>Write a Review</h4>' +
            '<div class="sm-review-form">' +
              '<div class="sm-review-form-rating">' +
                '<label>Your Rating:</label>' +
                '<div class="sm-review-stars-input" id="sm-review-stars">' +
                  [1,2,3,4,5].map(function (n) { return '<span class="sm-review-star" data-val="' + n + '">&#9733;</span>'; }).join('') +
                '</div>' +
                '<input type="hidden" id="sm-review-rating" value="5">' +
              '</div>' +
              '<div class="sm-review-form-group">' +
                '<label>Title</label>' +
                '<input type="text" id="sm-review-title" class="form-control" placeholder="Summarize your review" maxlength="200">' +
              '</div>' +
              '<div class="sm-review-form-group">' +
                '<label>Your Review</label>' +
                '<textarea id="sm-review-text" class="form-control" rows="4" placeholder="Share your experience..." maxlength="2000"></textarea>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" id="sm-submit-review">Submit Review</button>' +
            '</div>' +
          '</div>';
        bindReviewForm(productId);
      }).catch(function () {
        formWrap.innerHTML = '';
      });
    } else {
      formWrap.innerHTML = '<div class="sm-review-login"><a href="/login.html">Sign in</a> to write a review.</div>';
    }
  }

  function bindReviewForm(productId) {
    var starInput = $('sm-review-stars');
    var ratingInput = $('sm-review-rating');
    var submitBtn = $('sm-submit-review');

    if (starInput) {
      setStarDisplay(5);
      starInput.addEventListener('click', function (e) {
        var star = e.target.closest('.sm-review-star');
        if (!star) return;
        var val = parseInt(star.getAttribute('data-val'), 10);
        if (ratingInput) ratingInput.value = val;
        setStarDisplay(val);
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var rating = ratingInput ? parseInt(ratingInput.value, 10) : 5;
        var title = $('sm-review-title') ? $('sm-review-title').value.trim() : '';
        var review = $('sm-review-text') ? $('sm-review-text').value.trim() : '';
        if (!title) { SM.toast('Please enter a title for your review.', 'error'); return; }
        if (!review) { SM.toast('Please write your review.', 'error'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        SM.api('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({ product_id: productId, rating: rating, title: title, review: review })
        }).then(function () {
          SM.toast('Review submitted!');
          loadReviews(productId);
          loadRatings(productId);
        }).catch(function (err) {
          SM.toast(err.message || 'Failed to submit review', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Review';
        });
      });
    }
  }

  function setStarDisplay(val) {
    var stars = document.querySelectorAll('#sm-review-stars .sm-review-star');
    stars.forEach(function (s) {
      var v = parseInt(s.getAttribute('data-val'), 10);
      s.classList.toggle('active', v <= val);
    });
  }

  function loadRelated(p) {
    SM.api('/api/products/' + p.id + '/related?limit=4').then(function (items) {
      if (!items || items.length === 0) return;
      $('sm-related-section').style.display = '';
      $('sm-related-grid').innerHTML = items.map(SM.productCard).join('');
    }).catch(function () {});
  }

  function checkWishlist(productId) {
    if (!SM.isLoggedIn()) return;
    SM.api('/api/wishlist/check?product_id=' + productId).then(function (data) {
      isWished = data.wished;
      var btn = $('sm-wishlist-btn');
      if (btn) {
        btn.classList.toggle('wished', isWished);
        btn.innerHTML = '<span class="sm-pdp-wishlist-icon">' + (isWished ? '&#9829;' : '&#9825;') + '</span>';
      }
    }).catch(function () {});
  }

  function toggleWishlist(productId) {
    var btn = $('sm-wishlist-btn');
    if (isWished) {
      SM.api('/api/wishlist/' + productId, { method: 'DELETE' }).then(function () {
        isWished = false;
        if (btn) { btn.classList.remove('wished'); btn.innerHTML = '<span class="sm-pdp-wishlist-icon">&#9825;</span>'; }
        SM.toast('Removed from wishlist');
      }).catch(function (err) { SM.toast(err.message || 'Failed', 'error'); });
    } else {
      SM.api('/api/wishlist', { method: 'POST', body: JSON.stringify({ product_id: productId }) }).then(function () {
        isWished = true;
        if (btn) { btn.classList.add('wished'); btn.innerHTML = '<span class="sm-pdp-wishlist-icon">&#9829;</span>'; }
        SM.toast('Added to wishlist');
      }).catch(function (err) { SM.toast(err.message || 'Failed', 'error'); });
    }
  }

  function renderRecentlyViewed() {
    try {
      var items = JSON.parse(localStorage.getItem('sm_recently_viewed') || '[]');
      var currentId = currentProduct ? currentProduct.id : null;
      items = items.filter(function (i) { return i.id !== currentId; }).slice(0, 4);
      if (items.length === 0) return;

      $('sm-recent-section').style.display = '';
      $('sm-recent-grid').innerHTML = items.map(function (item) {
        return '<div class="col-lg-3 col-md-4 col-6 mb-4">' +
          '<a href="/product/' + item.id + '" class="product-item md-height bg-gray d-block">' +
            '<img src="' + SM.escapeHtml(item.image_url || '') + '" alt="' + SM.escapeHtml(item.name) + '" class="img-fluid">' +
          '</a>' +
          '<h2 class="item-title"><a href="/product/' + item.id + '">' + SM.escapeHtml(item.name) + '</a></h2>' +
          '<div class="sm-current-price">' + SM.money(item.price) + '</div>' +
        '</div>';
      }).join('');
    } catch (e) {}
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    renderRecentlyViewed();
  });
})();
