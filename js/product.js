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
        if (v.color && colors.indexOf(v.color) === -1) { colors.push(v.color); }
      });
      if (sizes.length === 0) sizes = p.sizes || ['One Size'];
      if (colors.length === 0) colors = p.colors ? p.colors.map(function (c) { return typeof c === 'object' ? c.name : c; }) : ['Default'];
    } else {
      colorObjects = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      colors = colorObjects;
      sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    }

    selectedSize = sizes[0] || 'One Size';
    selectedColor = colors[0] || 'Default';
    selectedVariant = hasVariants ? findVariant(p.variants, selectedSize, colorDisplay(selectedColor)) : null;
    var _allColors = colors;

    function colorDisplay(c) { return typeof c === 'object' ? c.name : String(c); }

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
    var material = p.material || p.fabric || '';

    var deliveryHtml =
      '<div class="sm-tab-delivery">' +
        '<h4>Delivery</h4>' +
        '<ul>' +
          '<li>Free standard delivery on orders over \u20B91000</li>' +
          '<li>Standard delivery: 3-7 business days (\u20B950 flat)</li>' +
          '<li>Express delivery: 1-3 business days (\u20B9150 flat)</li>' +
          '<li>Cash on delivery available for orders under \u20B95000</li>' +
        '</ul>' +
        '<h4>Returns & Exchanges</h4>' +
        '<ul>' +
          '<li>Easy 30-day return policy</li>' +
          '<li>Free returns for defective items</li>' +
          '<li>Items must be unworn with original tags attached</li>' +
          '<li>Refund processed within 5-7 business days</li>' +
          '<li>Exchange available for different size/color</li>' +
        '</ul>' +
      '</div>';

    var tabs = [
      { id: 'tab-desc', label: 'Description', content: '<div class="sm-tab-desc">' + (desc ? '<p>' + SM.escapeHtml(desc) + '</p>' : '<p>No description available.</p>') + (details ? '<p>' + SM.escapeHtml(details) + '</p>' : '') + '</div>' },
      { id: 'tab-material', label: 'Material & Care', content: '<div class="sm-tab-material">' +
        (material ? '<p>' + SM.escapeHtml(material) + '</p>' : '<p>Material information not available.</p>') +
        '<h4>Care Instructions</h4>' +
        '<ul>' +
          '<li>Machine wash cold with like colors</li>' +
          '<li>Tumble dry low</li>' +
          '<li>Do not bleach</li>' +
          '<li>Iron on low heat if needed</li>' +
          '<li>Do not dry clean</li>' +
        '</ul></div>' },
      { id: 'tab-delivery', label: 'Delivery & Returns', content: deliveryHtml },
      { id: 'tab-sizeguide', label: 'Size Guide', content: buildSizeGuideHtml(p) }
    ];

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
        var nameEl = $('sm-pdp-color-name');
        if (nameEl) nameEl.textContent = cname;

        if (hasImages) {
          var filtered = p.images.filter(function (img) { return !img.color || img.color === '' || img.color === cname; });
          if (filtered.length > 0) {
            var mainImg = $('sm-pdp-main-img');
            if (mainImg) mainImg.src = filtered[0].url;
            var tw = $('sm-pdp-thumbs');
            if (tw && filtered.length > 1) {
              tw.innerHTML = filtered.map(function (img, i2) {
                return '<button type="button" class="sm-pdp-thumb' + (i2 === 0 ? ' active' : '') + '" data-url="' + SM.escapeHtml(img.url) + '"><img src="' + SM.escapeHtml(img.url) + '" alt=""></button>';
              }).join('');
            }
          }
        }

        if (hasVariants) {
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
          '<span class="sm-review-date">' + new Date(r.created_at).toLocaleDateString() + '</span>' +
        '</div>' +
        (r.title ? '<div class="sm-review-title">' + SM.escapeHtml(r.title) + '</div>' : '') +
        (r.comment ? '<div class="sm-review-body">' + SM.escapeHtml(r.comment) + '</div>' : '') +
      '</div>';
    }).join('');

    $('sm-reviews-list').innerHTML = reviewsHtml || '<p class="text-muted">No reviews yet. Be the first to review this product!</p>';

    var formHtml = '';
    if (SM.isLoggedIn()) {
      formHtml =
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
              '<label>Title (optional)</label>' +
              '<input type="text" id="sm-review-title" class="form-control" placeholder="Summarize your review" maxlength="200">' +
            '</div>' +
            '<div class="sm-review-form-group">' +
              '<label>Your Review</label>' +
              '<textarea id="sm-review-comment" class="form-control" rows="4" placeholder="Share your experience..." maxlength="2000"></textarea>' +
            '</div>' +
            '<button type="button" class="btn btn-primary" id="sm-submit-review">Submit Review</button>' +
          '</div>' +
        '</div>';
    } else {
      formHtml = '<div class="sm-review-login"><a href="/login.html">Sign in</a> to write a review.</div>';
    }
    $('sm-review-form-wrap').innerHTML = formHtml;

    if (SM.isLoggedIn()) {
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
          var comment = $('sm-review-comment') ? $('sm-review-comment').value.trim() : '';
          if (!comment) { SM.toast('Please write a review.', 'error'); return; }
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting...';
          SM.api('/api/reviews', {
            method: 'POST',
            body: JSON.stringify({ product_id: productId, rating: rating, title: title, comment: comment })
          }).then(function () {
            SM.toast('Review submitted!');
            loadReviews(productId);
          }).catch(function (err) {
            SM.toast(err.message || 'Failed to submit review', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Review';
          });
        });
      }
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
