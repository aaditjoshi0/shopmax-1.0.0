(function () {
  'use strict';
  var SM = window.ShopMax;

  function showError(msg) {
    var root = document.getElementById('sm-product-root');
    if (!root) return;
    root.className = 'sm-empty';
    root.innerHTML = '<span class="icon icon-search"></span><h3>' + msg + '</h3><p><a href="/shop.html">Back to Shop</a></p>';
  }

  function init() {
    if (!SM) {
      console.error('[product] ShopMax not loaded');
      showError('Website failed to load. Please refresh.');
      return;
    }

    var m = window.location.pathname.match(/\/product\/(\d+)/);
    var id = m ? m[1] : SM.qs('id');
    if (!id) { showError('Product not found.'); return; }

    SM.api('/api/products/' + id)
      .then(function (p) {
        if (!p || !p.id) { showError('Product not found.'); return; }
        render(p);
      })
      .catch(function (err) {
        console.error('[product] API error:', err);
        showError('Unable to load product. Please try again.');
      });
  }

  var selectedSize = null;
  var selectedColor = null;
  var qty = 1;

  function render(p) {
    var oos = p.stock === 0;
    var lowStock = p.stock > 0 && p.stock <= 5;

    document.getElementById('sm-crumb-cat').textContent = cap(p.category);
    document.getElementById('sm-crumb-cat').href = '/' + (p.category === 'home' ? 'shop' : p.category) + '.html';
    document.getElementById('sm-crumb-name').textContent = p.name;
    document.title = p.name + ' — ShopMax';

    var root = document.getElementById('sm-product-root');
    root.classList.remove('sm-loading');
    root.className = 'row';

    var colors = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
    selectedColor = colors[0];

    var colorThumbs = colors.map(function (c, idx) {
      return '<button type="button" class="sm-color-thumb' + (idx === 0 ? ' selected' : '') + '" data-idx="' + idx + '" title="' + SM.escapeHtml(c.name) + '">' +
        '<span class="sm-color-swatch" style="background:' + SM.escapeHtml(c.hex) + '"></span>' +
        '<span class="sm-color-name">' + SM.escapeHtml(c.name) + '</span>' +
      '</button>';
    }).join('');

    var sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    selectedSize = sizes[0];
    var sizeBtns = sizes.map(function (s, idx) {
      return '<button type="button" class="sm-size-btn' + (idx === 0 ? ' selected' : '') + '" data-size="' + SM.escapeHtml(s) + '"' + (oos ? ' disabled' : '') + '>' + SM.escapeHtml(s) + '</button>';
    }).join('');

    var stockLabel = '';
    if (oos) {
      stockLabel = '<p class="sm-stock-badge sm-out-of-stock" style="font-size:15px;">OUT OF STOCK</p>';
    } else if (lowStock) {
      stockLabel = '<p class="sm-stock-badge sm-low-stock" style="font-size:15px;">Only ' + p.stock + ' left!</p>';
    } else {
      stockLabel = '<p class="sm-stock-ok">In Stock: ' + p.stock + ' items</p>';
    }

    var addToCartHtml = oos
      ? '<button type="button" class="sm-add-cart-btn sm-add-cart-oos" disabled>Out of Stock</button>'
      : '<button type="button" class="sm-add-cart-btn" id="sm-add-cart">Add To Cart</button>';

    root.innerHTML =
      '<div class="col-md-6">' +
        '<div class="sm-main-image-wrap">' +
          '<div class="sm-main-image' + (oos ? ' sm-product-oos' : '') + '">' +
            '<img src="' + SM.escapeHtml(selectedColor.image_url) + '" alt="' + SM.escapeHtml(p.name) + '" id="sm-main-img" class="img-fluid">' +
            (oos ? '<div class="sm-oos-overlay">OUT OF STOCK</div>' : '') +
          '</div>' +
          '<div class="sm-color-thumbs" id="sm-color-thumbs">' + colorThumbs + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-md-6">' +
        '<h2 class="sm-prod-name">' + SM.escapeHtml(p.name) + '</h2>' +
        '<div class="sm-prod-rating">' + (p.rating ? SM.starHtml(p.rating) : '') + '</div>' +
        '<div class="sm-prod-price">' +
          '<span class="sm-current-price">' + SM.money(p.price) + '</span>' +
          (p.compare_at_price && p.compare_at_price > p.price ? ' <span class="sm-old-price"><del>' + SM.money(p.compare_at_price) + '</del></span>' : '') +
        '</div>' +
        '<p class="sm-prod-desc">' + SM.escapeHtml(p.description || '') + '</p>' +
        stockLabel +
        '<div class="sm-color-section">' +
          '<label class="sm-section-label">Color: <span id="sm-selected-color-name">' + SM.escapeHtml(colors[0].name) + '</span></label>' +
          '<div class="sm-color-thumbs-row" id="sm-color-thumbs-row">' + colorThumbs + '</div>' +
        '</div>' +
        '<div class="sm-size-section">' +
          '<div class="sm-size-header">' +
            '<label class="sm-section-label">Size</label>' +
            '<a href="#" class="sm-size-guide" id="sm-size-guide-link">Size Guide</a>' +
          '</div>' +
          '<div class="sm-size-row" id="sm-size-row">' + sizeBtns + '</div>' +
        '</div>' +
        '<div class="sm-qty-section">' +
          '<label class="sm-section-label">Quantity</label>' +
          '<div class="sm-qty-selector">' +
            '<button type="button" class="sm-qty-btn sm-qty-minus" id="sm-qty-minus"' + (oos ? ' disabled' : '') + '>-</button>' +
            '<span class="sm-qty-value" id="sm-qty-value">1</span>' +
            '<button type="button" class="sm-qty-btn sm-qty-plus" id="sm-qty-plus"' + (oos ? ' disabled' : '') + '>+</button>' +
          '</div>' +
        '</div>' +
        '<div class="sm-add-cart-section">' + addToCartHtml + '</div>' +
      '</div>';

    if (oos) return;

    // Color selection (image thumbnails)
    var allThumbContainers = root.querySelectorAll('.sm-color-thumbs, .sm-color-thumbs-row');
    allThumbContainers.forEach(function (container) {
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-color-thumb');
        if (!btn) return;
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var c = colors[idx];
        if (!c) return;
        document.getElementById('sm-main-img').src = c.image_url;
        var nameEl = document.getElementById('sm-selected-color-name');
        if (nameEl) nameEl.textContent = c.name;
        root.querySelectorAll('.sm-color-thumb').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedColor = c;
      });
    });

    // Size selection
    var sizeRow = document.getElementById('sm-size-row');
    if (sizeRow) {
      sizeRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-size-btn');
        if (!btn) return;
        sizeRow.querySelectorAll('.sm-size-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedSize = btn.getAttribute('data-size');
      });
    }

    // Size Guide modal
    var guideLink = document.getElementById('sm-size-guide-link');
    if (guideLink) {
      guideLink.addEventListener('click', function (e) {
        e.preventDefault();
        showSizeGuide(p);
      });
    }

    // Quantity
    var qtyEl = document.getElementById('sm-qty-value');
    var minusBtn = document.getElementById('sm-qty-minus');
    var plusBtn = document.getElementById('sm-qty-plus');
    if (minusBtn) minusBtn.addEventListener('click', function () {
      qty = Math.max(1, qty - 1);
      if (qtyEl) qtyEl.textContent = qty;
    });
    if (plusBtn) plusBtn.addEventListener('click', function () {
      qty = Math.min(p.stock, qty + 1);
      if (qtyEl) qtyEl.textContent = qty;
    });

    // Add to Cart
    var cartBtn = document.getElementById('sm-add-cart');
    if (cartBtn) {
      cartBtn.addEventListener('click', function () {
        SM.addToCart({
          product_id: p.id,
          name: p.name,
          price: p.price,
          image_url: selectedColor.image_url,
          size: selectedSize,
          quantity: qty,
          color: selectedColor.name
        }).then(function () {
          SM.toast('Added ' + qty + ' × ' + p.name + ' to cart');
          cartBtn.textContent = '✓ Added!';
          cartBtn.classList.add('sm-added');
          setTimeout(function () { cartBtn.textContent = 'Add To Cart'; cartBtn.classList.remove('sm-added'); }, 1500);
        }).catch(function (err) {
          SM.toast(err.message || 'Failed to add to cart', 'error');
        });
      });
    }
  }

  function showSizeGuide(p) {
    var sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    var rows = sizes.map(function (s) {
      var chest = '-', waist = '-', length = '-';
      if (s === 'XS') { chest = 32; waist = 26; length = 24; }
      else if (s === 'S') { chest = 36; waist = 30; length = 26; }
      else if (s === 'M') { chest = 40; waist = 34; length = 28; }
      else if (s === 'L') { chest = 44; waist = 38; length = 30; }
      else if (s === 'XL') { chest = 48; waist = 42; length = 32; }
      else if (s === 'XXL') { chest = 52; waist = 46; length = 34; }
      else if (/^[2-5]T$/.test(s)) { var n = parseInt(s); chest = n*2+16; waist = n*2+14; length = n+12; }
      else if (/^\d+$/.test(s)) { var n2 = parseInt(s); chest = n2+32; waist = n2+28; length = n2+24; }
      return '<tr><td>' + SM.escapeHtml(s) + '</td><td>' + chest + '</td><td>' + waist + '</td><td>' + length + '</td></tr>';
    }).join('');

    var table = '<table class="sm-size-guide-table"><thead><tr><th>Size</th><th>Chest (in)</th><th>Waist (in)</th><th>Length (in)</th></tr></thead><tbody>' + rows + '</tbody></table>';

    var overlay = document.createElement('div');
    overlay.className = 'sm-size-guide-overlay';
    overlay.innerHTML =
      '<div class="sm-size-guide-modal">' +
        '<div class="sm-size-guide-modal-header"><h3>Size Guide</h3><button type="button" class="sm-size-guide-close">&times;</button></div>' +
        '<div class="sm-size-guide-modal-body"><p>All measurements are in inches.</p>' + table + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.sm-size-guide-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  document.addEventListener('DOMContentLoaded', init);
})();
