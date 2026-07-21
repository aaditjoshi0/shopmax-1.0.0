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
  var selectedVariant = null;
  var qty = 1;

  function render(p) {
    var hasVariants = p.variants && p.variants.length > 0;
    var hasImages = p.images && p.images.length > 0;
    var oos = p.stock === 0;
    var lowStock = p.stock > 0 && p.stock <= 5;

    document.getElementById('sm-crumb-cat').textContent = cap(p.category);
    document.getElementById('sm-crumb-cat').href = '/' + (p.category === 'home' ? 'shop' : p.category) + '.html';
    document.getElementById('sm-crumb-name').textContent = p.name;
    document.title = p.name + ' — ShopMax';

    var root = document.getElementById('sm-product-root');
    root.classList.remove('sm-loading');
    root.className = 'row';

    // Derive sizes, colors, and default variant
    var sizes = [];
    var colors = [];
    var defaultVariant = null;

    if (hasVariants) {
      p.variants.forEach(function (v) {
        if (v.status !== 'published') return;
        if (v.size && sizes.indexOf(v.size) === -1) sizes.push(v.size);
        if (v.color && colors.indexOf(v.color) === -1) colors.push(v.color);
      });
      if (sizes.length === 0) sizes = p.sizes || ['One Size'];
      if (colors.length === 0) colors = p.colors ? p.colors.map(function (c) { return typeof c === 'object' ? c.name : c; }) : ['Default'];
      // Find first published variant as default
      defaultVariant = p.variants.find(function (v) { return v.status === 'published'; }) || p.variants[0];
    } else {
      var rawColors = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      colors = rawColors;
      sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    }

    selectedSize = sizes[0] || 'One Size';
    selectedColor = colors[0] || 'Default';
    selectedVariant = hasVariants ? findVariant(p.variants, selectedSize, selectedColor) : null;

    // Get color display value
    function colorDisplay(c) {
      return typeof c === 'object' ? c.name : String(c);
    }

    // Build image gallery
    var mainImgUrl = '';
    var galleryHtml = '';
    if (hasImages) {
      var filteredImages = p.images.filter(function (img) {
        return !img.color || img.color === '' || img.color === colorDisplay(selectedColor);
      });
      if (filteredImages.length === 0) filteredImages = p.images;
      mainImgUrl = filteredImages[0].url;
      galleryHtml = '<div class="sm-image-gallery" id="sm-image-gallery">' +
        filteredImages.map(function (img, idx) {
          return '<button type="button" class="sm-gallery-thumb' + (idx === 0 ? ' selected' : '') + '" data-url="' + SM.escapeHtml(img.url) + '">' +
            '<img src="' + SM.escapeHtml(img.url) + '" alt="' + SM.escapeHtml(img.alt || '') + '">' +
          '</button>';
        }).join('') + '</div>';
    } else if (hasVariants) {
      // Use color image_url if set on variant color objects
      var colorObj = p.colors && p.colors.find(function (c) { return c.name === colorDisplay(selectedColor); });
      mainImgUrl = (colorObj && colorObj.image_url) || p.image_url;
    } else {
      mainImgUrl = (typeof colors[0] === 'object' && colors[0].image_url) || p.image_url;
    }

    // Color section
    var colorHtml = hasVariants
      ? colors.map(function (c, idx) {
          var name = typeof c === 'object' ? c.name : String(c);
          var hex = typeof c === 'object' ? c.hex : '#cccccc';
          return '<button type="button" class="sm-color-thumb' + (idx === 0 ? ' selected' : '') + '" data-color="' + SM.escapeHtml(name) + '">' +
            '<span class="sm-color-swatch" style="background:' + hex + '"></span>' +
            '<span class="sm-color-name">' + SM.escapeHtml(name) + '</span></button>';
        }).join('')
      : colors.map(function (c, idx) {
          var hex = typeof c === 'object' ? c.hex : '#cccccc';
          return '<button type="button" class="sm-color-thumb' + (idx === 0 ? ' selected' : '') + '" data-idx="' + idx + '" title="' + SM.escapeHtml(c.name || c) + '">' +
            '<span class="sm-color-swatch" style="background:' + hex + '"></span>' +
            '<span class="sm-color-name">' + SM.escapeHtml(c.name || c) + '</span></button>';
        }).join('');

    var sizeBtns = sizes.map(function (s, idx) {
      return '<button type="button" class="sm-size-btn' + (idx === 0 ? ' selected' : '') + '" data-size="' + SM.escapeHtml(s) + '">' + SM.escapeHtml(s) + '</button>';
    }).join('');

    // Determine price from variant or product
    var displayPrice = selectedVariant ? selectedVariant.price : p.price;
    var displayCompare = selectedVariant ? selectedVariant.compare_at_price : p.compare_at_price;
    var displayStock = selectedVariant ? selectedVariant.stock : p.stock;
    var currentOos = displayStock === 0;
    var currentLowStock = displayStock > 0 && displayStock <= 5;

    var stockLabel = '';
    if (currentOos) {
      stockLabel = '<p class="sm-stock-badge sm-out-of-stock" style="font-size:15px;">OUT OF STOCK</p>';
    } else if (currentLowStock) {
      stockLabel = '<p class="sm-stock-badge sm-low-stock" style="font-size:15px;">Only ' + displayStock + ' left!</p>';
    } else if (hasVariants) {
      stockLabel = '<p class="sm-stock-ok">In Stock</p>';
    } else {
      stockLabel = '<p class="sm-stock-ok">In Stock: ' + displayStock + ' items</p>';
    }

    var addToCartHtml = currentOos
      ? '<button type="button" class="sm-add-cart-btn sm-add-cart-oos" disabled>Out of Stock</button>'
      : '<button type="button" class="sm-add-cart-btn" id="sm-add-cart">Add To Cart</button>';

    root.innerHTML =
      '<div class="col-md-6">' +
        '<div class="sm-main-image-wrap">' +
          '<div class="sm-main-image' + (currentOos ? ' sm-product-oos' : '') + '">' +
            '<img src="' + SM.escapeHtml(mainImgUrl) + '" alt="' + SM.escapeHtml(p.name) + '" id="sm-main-img" class="img-fluid">' +
            (currentOos ? '<div class="sm-oos-overlay">OUT OF STOCK</div>' : '') +
          '</div>' +
          galleryHtml +
          (!hasImages ? '<div class="sm-color-thumbs" id="sm-color-thumbs">' + colorHtml + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="col-md-6">' +
        '<h2 class="sm-prod-name">' + SM.escapeHtml(p.name) + '</h2>' +
        '<div class="sm-prod-rating">' + (p.rating ? SM.starHtml(p.rating) : '') + '</div>' +
        '<div class="sm-prod-price">' +
          '<span class="sm-current-price">' + SM.money(displayPrice) + '</span>' +
          (displayCompare && displayCompare > displayPrice ? ' <span class="sm-old-price"><del>' + SM.money(displayCompare) + '</del></span>' : '') +
        '</div>' +
        '<p class="sm-prod-desc">' + SM.escapeHtml(p.description || '') + '</p>' +
        stockLabel +
        '<div class="sm-color-section">' +
          '<label class="sm-section-label">Color: <span id="sm-selected-color-name">' + SM.escapeHtml(colorDisplay(selectedColor)) + '</span></label>' +
          '<div class="sm-color-thumbs-row" id="sm-color-thumbs-row">' + colorHtml + '</div>' +
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
            '<button type="button" class="sm-qty-btn sm-qty-minus" id="sm-qty-minus">-</button>' +
            '<span class="sm-qty-value" id="sm-qty-value">1</span>' +
            '<button type="button" class="sm-qty-btn sm-qty-plus" id="sm-qty-plus">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="sm-add-cart-section">' + addToCartHtml + '</div>' +
      '</div>';

    // Update UI based on selection
    function updateVariantUI() {
      var v = selectedVariant;
      if (v) {
        var vPrice = v.price;
        var vCompare = v.compare_at_price;
        var vStock = v.stock;
        var vOos = vStock === 0;
        var vLowStock = vStock > 0 && vStock <= 5;

        var priceEl = root.querySelector('.sm-current-price');
        var compareEl = root.querySelector('.sm-old-price');
        if (priceEl) priceEl.innerHTML = SM.money(vPrice);
        if (compareEl) {
          if (vCompare && vCompare > vPrice) {
            compareEl.innerHTML = '<del>' + SM.money(vCompare) + '</del>';
            compareEl.style.display = '';
          } else {
            compareEl.style.display = 'none';
          }
        }

        var stockEl = root.querySelector('.sm-stock-badge, .sm-stock-ok');
        if (stockEl) {
          if (vOos) {
            stockEl.outerHTML = '<p class="sm-stock-badge sm-out-of-stock" style="font-size:15px;">OUT OF STOCK</p>';
          } else if (vLowStock) {
            stockEl.outerHTML = '<p class="sm-stock-badge sm-low-stock" style="font-size:15px;">Only ' + vStock + ' left!</p>';
          } else {
            stockEl.outerHTML = '<p class="sm-stock-ok">In Stock</p>';
          }
        }

        var cartBtn = document.getElementById('sm-add-cart');
        if (cartBtn) {
          if (vOos) {
            cartBtn.outerHTML = '<button type="button" class="sm-add-cart-btn sm-add-cart-oos" disabled>Out of Stock</button>';
          } else {
            if (!document.getElementById('sm-add-cart')) {
              var wrapper = root.querySelector('.sm-add-cart-section');
              if (wrapper) wrapper.innerHTML = '<button type="button" class="sm-add-cart-btn" id="sm-add-cart">Add To Cart</button>';
            }
          }
        }

        qty = 1;
        var qtyEl = document.getElementById('sm-qty-value');
        if (qtyEl) qtyEl.textContent = 1;
      }
    }

    // Image gallery interaction
    var gallery = document.getElementById('sm-image-gallery');
    if (gallery) {
      gallery.addEventListener('click', function (e) {
        var thumb = e.target.closest('.sm-gallery-thumb');
        if (!thumb) return;
        var url = thumb.getAttribute('data-url');
        var mainImg = document.getElementById('sm-main-img');
        if (mainImg) mainImg.src = url;
        gallery.querySelectorAll('.sm-gallery-thumb').forEach(function (b) { b.classList.remove('selected'); });
        thumb.classList.add('selected');
      });
    }

    // Color selection (non-variant mode via thumbs)
    if (!hasImages) {
      var allThumbContainers = root.querySelectorAll('.sm-color-thumbs, .sm-color-thumbs-row');
      allThumbContainers.forEach(function (container) {
        container.addEventListener('click', function (e) {
          var btn = e.target.closest('.sm-color-thumb');
          if (!btn) return;

          var newColor;
          if (hasVariants) {
            newColor = btn.getAttribute('data-color');
          } else {
            var idx = parseInt(btn.getAttribute('data-idx'), 10);
            newColor = colors[idx];
          }
          if (!newColor) return;

          selectedColor = newColor;
          var colorName = typeof newColor === 'object' ? newColor.name : String(newColor);

          // Update main image
          if (hasImages) {
            var filtered = p.images.filter(function (img) {
              return !img.color || img.color === '' || img.color === colorName;
            });
            if (filtered.length > 0) {
              document.getElementById('sm-main-img').src = filtered[0].url;
              // Rebuild gallery
              gallery.innerHTML = filtered.map(function (img, idx) {
                return '<button type="button" class="sm-gallery-thumb' + (idx === 0 ? ' selected' : '') + '" data-url="' + SM.escapeHtml(img.url) + '">' +
                  '<img src="' + SM.escapeHtml(img.url) + '" alt="' + SM.escapeHtml(img.alt || '') + '"></button>';
              }).join('');
            }
          } else if (!hasVariants) {
            document.getElementById('sm-main-img').src = newColor.image_url || p.image_url;
          }

          var nameEl = document.getElementById('sm-selected-color-name');
          if (nameEl) nameEl.textContent = colorName;

          root.querySelectorAll('.sm-color-thumb').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');

          // Update variant
          if (hasVariants) {
            selectedVariant = findVariant(p.variants, selectedSize, colorName);
            updateVariantUI();
          }
        });
      });
    }

    // Size selection
    var sizeRow = document.getElementById('sm-size-row');
    if (sizeRow) {
      sizeRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.sm-size-btn');
        if (!btn) return;
        sizeRow.querySelectorAll('.sm-size-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedSize = btn.getAttribute('data-size');

        if (hasVariants) {
          var colorName = typeof selectedColor === 'object' ? selectedColor.name : String(selectedColor);
          selectedVariant = findVariant(p.variants, selectedSize, colorName);
          updateVariantUI();
        }
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
      var maxStock = selectedVariant ? selectedVariant.stock : p.stock;
      qty = Math.min(maxStock || 999, qty + 1);
      if (qtyEl) qtyEl.textContent = qty;
    });

    // Add to Cart
    var cartBtn = document.getElementById('sm-add-cart');
    if (cartBtn) {
      cartBtn.addEventListener('click', function () {
        var colorName = typeof selectedColor === 'object' ? selectedColor.name : String(selectedColor);
        var price = selectedVariant ? selectedVariant.price : p.price;
        var imgUrl = p.image_url;
        if (hasImages) {
          var filtered = p.images.filter(function (img) {
            return !img.color || img.color === '' || img.color === colorName;
          });
          imgUrl = filtered.length > 0 ? filtered[0].url : p.image_url;
        } else if (hasVariants) {
          var co = p.colors && p.colors.find(function (c) { return c.name === colorName; });
          imgUrl = (co && co.image_url) || p.image_url;
        } else if (typeof selectedColor === 'object' && selectedColor.image_url) {
          imgUrl = selectedColor.image_url;
        }

        SM.addToCart({
          product_id: p.id,
          variant_id: selectedVariant ? selectedVariant.id : null,
          name: p.name,
          price: price,
          image_url: imgUrl,
          size: selectedSize,
          quantity: qty,
          color: colorName
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

  function findVariant(variants, size, color) {
    return variants.find(function (v) {
      return v.status === 'published' && v.size === size && v.color === color;
    }) || variants.find(function (v) {
      return v.status === 'published' && (v.size === size || v.color === color);
    }) || null;
  }

  function showSizeGuide(p) {
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
