(function () {
  'use strict';
  var SM = window.ShopMax;

  var currentProduct = null;
  var selectedColor = null;
  var selectedSize = null;
  var selectedPosition = 'Front';
  var step = 1;

  var MIN_SCALE = 0.3;
  var MAX_SCALE = 2.5;
  var ROTATE_STEP = 15;
  var MAX_FILE_MB = 10;

  var designs = { Front: null, Back: null, Sleeve: null };
  var texts = { Front: null, Back: null, Sleeve: null };
  var garmentUrl = '';
  var garmentImage = null;
  var dragging = null;
  var measureCtx = null;

  function $(id) { return document.getElementById(id); }

  // bindEvents() is one long chain of listener registrations. Using
  // $(id).addEventListener directly means a single missing element throws and
  // every binding after it never happens — the page then looks alive but its
  // buttons do nothing, with no clue why. Bind through this instead: it skips
  // what is absent and says so, so a stale page degrades instead of dying.
  function on(id, type, handler) {
    var el = $(id);
    if (!el) {
      console.warn('[customize] missing element #' + id + ' — "' + type + '" not bound. Try a hard refresh (Ctrl+F5).');
      return null;
    }
    // A handler that throws leaves the button looking simply dead. Surface it.
    el.addEventListener(type, function (e) {
      try {
        handler.call(this, e);
      } catch (err) {
        console.error('[customize] #' + id + ' ' + type + ' handler failed:', err);
        SM.toast((err && err.message) || 'Something went wrong.', 'error');
      }
    });
    return el;
  }

  // The canvas is exported with toDataURL() for the cart image, the saved
  // thumbnail and the marketplace preview. Drawing a cross-origin image without
  // CORS headers taints the canvas and makes every one of those exports throw.
  // Products added through the admin panel can point anywhere, so anything that
  // is not already same-origin is loaded through our own /api/image-proxy —
  // the browser then sees a same-origin image and the canvas stays clean.
  function canvasSafeSrc(url) {
    if (!url) return '';
    var s = String(url);
    // Relative paths, blob: and data: are already safe to export.
    if (!/^https?:\/\//i.test(s)) return s;
    try {
      if (new URL(s, window.location.href).origin === window.location.origin) return s;
    } catch (_) { /* fall through to the proxy */ }
    return '/api/image-proxy?url=' + encodeURIComponent(s);
  }

  // Load an image that will be drawn onto the exportable canvas.
  function loadCanvasImage(url, onLoad, onError) {
    var img = new Image();
    // Same-origin after canvasSafeSrc(), but declaring it keeps the request
    // anonymous and makes the intent explicit.
    img.crossOrigin = 'anonymous';
    img.onload = function () { onLoad(img); };
    img.onerror = function () { if (onError) onError(); };
    img.src = canvasSafeSrc(url);
    return img;
  }

  function colorName(c) { return typeof c === 'object' ? c.name : String(c); }
  function colorHex(c) { return typeof c === 'object' && c.hex ? c.hex : '#cccccc'; }
  function colorImage(c, p) { return (typeof c === 'object' && c.image_url) ? c.image_url : (p ? p.image_url : ''); }

  function currentDesign() { return designs[selectedPosition] || null; }
  function currentText() { return texts[selectedPosition] || null; }

  function showStep(n) {
    step = n;
    var i;
    for (i = 1; i <= 3; i++) {
      var panel = $('custom-step-' + i);
      if (panel) panel.style.display = (i === n ? '' : 'none');
    }
    var items = document.querySelectorAll('.sm-custom-step-item');
    for (i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', parseInt(items[i].getAttribute('data-step'), 10) <= n);
    }
    var lines = document.querySelectorAll('.sm-custom-step-line');
    for (i = 0; i < lines.length; i++) {
      lines[i].classList.toggle('done', parseInt(lines[i].getAttribute('data-line'), 10) < n);
    }
    if (n === 1) window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === 2) drawPreview();
  }

  function showGarmentError(msg) {
    $('sm-garment-loading').style.display = 'none';
    $('sm-garment-grid').style.display = 'none';
    var err = $('sm-garment-error');
    err.style.display = '';
    $('sm-garment-error-msg').textContent = msg;
  }

  function loadProducts() {
    $('sm-garment-loading').style.display = '';
    $('sm-garment-error').style.display = 'none';
    $('sm-garment-grid').style.display = '';

    SM.api('/api/products').then(function (products) {
      var list = Array.isArray(products) ? products : (products && products.products) ? products.products : [];
      $('sm-garment-loading').style.display = 'none';
      if (!list.length) { showGarmentError('No customizable products available right now.'); return; }
      var grid = $('sm-garment-grid');
      grid.innerHTML = list.map(garmentCard).join('');
    }).catch(function (err) {
      showGarmentError(err && err.message ? err.message : 'Unable to load products. Please try again.');
    });
  }

  function garmentCard(p) {
    var priceHtml = '<span class="sm-garment-price-cur">' + SM.money(p.price) + '</span>';
    if (p.compare_at_price && p.compare_at_price > p.price) {
      priceHtml += '<span class="sm-garment-price-old"><del>' + SM.money(p.compare_at_price) + '</del></span>';
    }
    return '<div class="col-lg-4 col-md-6 col-6 mb-4">' +
      '<div class="sm-garment-card">' +
        '<div class="sm-garment-img">' +
          '<img src="' + SM.escapeHtml(p.image_url || '') + '" alt="' + SM.escapeHtml(p.name) + '" class="img-fluid">' +
        '</div>' +
        '<div class="sm-garment-info">' +
          '<h3 class="sm-garment-name">' + SM.escapeHtml(p.name) + '</h3>' +
          '<div class="sm-garment-price">' + priceHtml + '</div>' +
          '<button type="button" class="sm-garment-select" data-id="' + p.id + '">Customize</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function selectProduct(id) {
    SM.api('/api/products/' + id).then(function (p) {
      if (!p || !p.id) { SM.toast('Product not found.', 'error'); return; }
      currentProduct = p;
      var colors = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      selectedColor = colors[0];
      selectedSize = (p.sizes && p.sizes.length) ? p.sizes[0] : 'One Size';
      selectedPosition = 'Front';
      renderCustomize(p, colors);
      loadGarment(colorImage(selectedColor, p));
      showStep(2);
    }).catch(function (err) {
      SM.toast(err && err.message ? err.message : 'Failed to load product.', 'error');
    });
  }

  function renderCustomize(p, colors) {
    $('custom-product-name').textContent = p.name;
    $('custom-product-price').textContent = SM.money(p.price);

    var colorHtml = colors.map(function (col, idx) {
      var name = colorName(col);
      return '<button type="button" class="sm-pdp-color' + (idx === 0 ? ' active' : '') + '" data-idx="' + idx + '" title="' + SM.escapeHtml(name) + '">' +
        '<span class="sm-pdp-color-swatch" style="background:' + colorHex(col) + '"></span>' +
        '<span class="sm-pdp-color-label">' + SM.escapeHtml(name) + '</span>' +
      '</button>';
    }).join('');
    $('custom-colors').innerHTML = colorHtml;

    var sizes = (p.sizes && p.sizes.length) ? p.sizes : ['One Size'];
    var sizeHtml = sizes.map(function (s, idx) {
      return '<button type="button" class="sm-pdp-size' + (idx === 0 ? ' active' : '') + '" data-size="' + SM.escapeHtml(s) + '">' + SM.escapeHtml(s) + '</button>';
    }).join('');
    $('custom-sizes').innerHTML = sizeHtml;
  }

  /* ---------------- design / canvas ---------------- */

  function canvasBox(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 300;
    var h = canvas.clientHeight || (w * 4 / 3);
    var pw = Math.round(w * dpr);
    var ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    return { w: w, h: h, dpr: dpr };
  }

  function measureText(text, font, px) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = px + 'px ' + font;
    return measureCtx.measureText(text).width;
  }

  function elementBox(el, w, h) {
    if (el.img) {
      var base = Math.min(w, h) * 0.35;
      var dw = base * el.scale;
      var dh = dw * (el.img.naturalHeight / (el.img.naturalWidth || 1));
      return { dw: dw, dh: dh };
    }
    var fontSize = h * 0.09 * el.scale;
    var tw = measureText(el.text, el.font, fontSize);
    return { dw: tw, dh: fontSize };
  }

  function clampElement(el, w, h) {
    var box = elementBox(el, w, h);
    var halfW = Math.min(box.dw / 2, w * 0.49);
    var halfH = Math.min(box.dh / 2, h * 0.49);
    el.fx = Math.min(Math.max(el.fx, halfW / w), 1 - halfW / w);
    el.fy = Math.min(Math.max(el.fy, halfH / h), 1 - halfH / h);
  }

  function drawScene(canvas, img, design, text) {
    if (!canvas) return;
    var box = canvasBox(canvas);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, box.w, box.h);

    if (img && img.complete && img.naturalWidth) {
      var s = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
      var iw = img.naturalWidth * s;
      var ih = img.naturalHeight * s;
      ctx.drawImage(img, (box.w - iw) / 2, (box.h - ih) / 2, iw, ih);
    }

    if (design && design.img) {
      var ds = elementBox(design, box.w, box.h);
      var cx = design.fx * box.w;
      var cy = design.fy * box.h;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(design.rotation * Math.PI / 180);
      ctx.drawImage(design.img, -ds.dw / 2, -ds.dh / 2, ds.dw, ds.dh);
      ctx.restore();
    }

    if (text && text.text) {
      var fontSize = box.h * 0.09 * text.scale;
      ctx.save();
      ctx.translate(text.fx * box.w, text.fy * box.h);
      ctx.rotate(text.rotation * Math.PI / 180);
      ctx.font = fontSize + 'px ' + text.font;
      ctx.fillStyle = text.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.text, 0, 0);
      ctx.restore();
    }
  }

  function drawPreview() {
    var canvas = $('custom-preview-canvas');
    if (!canvas) return;
    var design = currentDesign();
    var text = currentText();
    drawScene(canvas, garmentImage, design, text);

    var label = $('custom-preview-position');
    if (label) label.textContent = selectedPosition;

    var dz = $('sm-custom-dropzone');
    if (dz) dz.style.display = (design || text) ? 'none' : '';

    updateDesignTools();
    syncTextUI();
    canvas.classList.toggle('sm-grab', !!(design || text));
  }

  function loadGarment(url) {
    garmentUrl = url || '';
    if (!url) { garmentImage = null; drawPreview(); return; }
    loadCanvasImage(url, function (img) {
      if (garmentUrl === url) { garmentImage = img; drawPreview(); }
    }, function () {
      if (garmentUrl === url && currentProduct && currentProduct.image_url !== url) {
        loadGarment(currentProduct.image_url);
      } else if (garmentUrl === url) {
        // No garment to draw — the design itself still renders and exports.
        garmentImage = null;
        drawPreview();
      }
    });
  }

  function uploadDesign(file) {
    if (!file) return;
    var allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      SM.toast('Please choose a PNG, JPG, JPEG or WEBP image.', 'error');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      SM.toast('Image is too large. Maximum ' + MAX_FILE_MB + ' MB.', 'error');
      return;
    }
    var old = designs[selectedPosition];
    if (old && old.objectUrl) URL.revokeObjectURL(old.objectUrl);
    var url = URL.createObjectURL(file);

    // Also keep a data URL: blob: URLs die with the page, so the snapshot we
    // save (and anyone who later remixes it) needs the bytes inline. The read
    // and the decode race, so both sides write through this slot.
    var pending = { dataUrl: null, entry: null };
    var reader = new FileReader();
    reader.onload = function () {
      pending.dataUrl = reader.result;
      if (pending.entry) pending.entry.dataUrl = reader.result;
    };
    reader.readAsDataURL(file);

    var img = new Image();
    img.onload = function () {
      designs[selectedPosition] = {
        img: img,
        fx: 0.5,
        fy: 0.45,
        scale: 1,
        rotation: 0,
        fileName: file.name,
        objectUrl: url,
        dataUrl: pending.dataUrl
      };
      pending.entry = designs[selectedPosition];
      drawPreview();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      SM.toast('Could not read this image. Please try another file.', 'error');
    };
    img.src = url;
  }

  function removeDesign() {
    var d = designs[selectedPosition];
    if (!d) return;
    if (d.objectUrl) URL.revokeObjectURL(d.objectUrl);
    designs[selectedPosition] = null;
    drawPreview();
  }

  function clearAllDesigns() {
    var p;
    for (p in designs) {
      if (designs[p] && designs[p].objectUrl) URL.revokeObjectURL(designs[p].objectUrl);
      designs[p] = null;
    }
  }

  function setDesignScale(s) {
    var d = currentDesign();
    if (!d) return;
    d.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    var canvas = $('custom-preview-canvas');
    var box = canvasBox(canvas);
    clampElement(d, box.w, box.h);
    syncScaleUI();
    drawPreview();
  }

  function rotateDesign(delta) {
    var d = currentDesign();
    if (!d) return;
    d.rotation = ((d.rotation + delta) % 360 + 360) % 360;
    drawPreview();
  }

  function addText() {
    var val = $('custom-text-input').value.trim();
    if (!val) { SM.toast('Please type some text first.', 'error'); return; }
    texts[selectedPosition] = {
      text: val,
      font: $('custom-text-font').value || 'Arial',
      color: $('custom-text-color').value || '#000000',
      fx: 0.5,
      fy: 0.6,
      scale: 1,
      rotation: 0
    };
    drawPreview();
  }

  function removeText() {
    var t = currentText();
    if (!t) return;
    texts[selectedPosition] = null;
    drawPreview();
  }

  function clearTexts() {
    var p;
    for (p in texts) texts[p] = null;
  }

  function setTextScale(s) {
    var t = currentText();
    if (!t) return;
    t.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    var canvas = $('custom-preview-canvas');
    var box = canvasBox(canvas);
    clampElement(t, box.w, box.h);
    syncTextUI();
    drawPreview();
  }

  function rotateText(delta) {
    var t = currentText();
    if (!t) return;
    t.rotation = ((t.rotation + delta) % 360 + 360) % 360;
    drawPreview();
  }

  function syncTextUI() {
    var t = currentText();
    var tools = $('custom-text-tools');
    if (tools) tools.style.display = t ? '' : 'none';
    var slider = $('custom-text-slider');
    var label = $('custom-text-scale-label');
    if (!t) {
      if (slider) slider.value = 100;
      if (label) label.textContent = '100%';
      return;
    }
    var fontSel = $('custom-text-font');
    var colorIn = $('custom-text-color');
    if (fontSel && fontSel.value !== t.font) fontSel.value = t.font;
    if (colorIn && colorIn.value !== t.color) colorIn.value = t.color;
    var pct = Math.round(t.scale * 100);
    if (slider) slider.value = pct;
    if (label) label.textContent = pct + '%';
  }

  function syncScaleUI() {
    var d = currentDesign();
    var slider = $('custom-size-slider');
    var label = $('custom-scale-label');
    if (!d) {
      if (slider) slider.value = 100;
      if (label) label.textContent = '100%';
      return;
    }
    var pct = Math.round(d.scale * 100);
    if (slider) slider.value = pct;
    if (label) label.textContent = pct + '%';
  }

  function updateDesignTools() {
    var d = currentDesign();
    var tools = $('custom-design-tools');
    var note = $('custom-file-note');
    var nameEl = $('custom-file-name');
    if (tools) tools.style.display = d ? '' : 'none';
    if (note) note.style.display = d ? '' : 'none';
    if (nameEl) nameEl.textContent = d ? d.fileName : '';
    syncScaleUI();
  }

  function hitTest(el, px, py, w, h) {
    var box = elementBox(el, w, h);
    var cx = el.fx * w;
    var cy = el.fy * h;
    var a = -el.rotation * Math.PI / 180;
    var dx = px - cx;
    var dy = py - cy;
    var rx = dx * Math.cos(a) - dy * Math.sin(a);
    var ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= box.dw / 2 && Math.abs(ry) <= box.dh / 2;
  }

  function hitElement(px, py, w, h) {
    var t = currentText();
    if (t && t.text && hitTest(t, px, py, w, h)) return t;
    var d = currentDesign();
    if (d && hitTest(d, px, py, w, h)) return d;
    return null;
  }

  function bindCanvas(canvas) {
    if (!canvas) return;
    canvas.addEventListener('pointerdown', function (e) {
      var box = canvasBox(canvas);
      var el = hitElement(e.offsetX, e.offsetY, box.w, box.h);
      if (!el) return;
      dragging = { el: el, startX: e.offsetX, startY: e.offsetY, f0x: el.fx, f0y: el.fy };
      canvas.classList.add('sm-dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var el = dragging.el;
      var box = canvasBox(canvas);
      el.fx = dragging.f0x + (e.offsetX - dragging.startX) / box.w;
      el.fy = dragging.f0y + (e.offsetY - dragging.startY) / box.h;
      clampElement(el, box.w, box.h);
      drawPreview();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = null;
      canvas.classList.remove('sm-dragging');
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function continueToPreview() {
    if (!currentProduct) return;
    $('custom-final-name').textContent = currentProduct.name;
    $('custom-final-color').textContent = colorName(selectedColor);
    $('custom-final-size').textContent = selectedSize;
    $('custom-final-position').textContent = selectedPosition;
    $('custom-final-price').textContent = SM.money(currentProduct.price);

    var canvas = $('custom-final-canvas');
    var design = currentDesign();
    var text = currentText();
    var url = colorImage(selectedColor, currentProduct);
    if (garmentImage && garmentUrl === url) {
      drawScene(canvas, garmentImage, design, text);
    } else {
      loadCanvasImage(url, function (img) {
        drawScene(canvas, img, design, text);
      }, function () {
        drawScene(canvas, null, design, text);
      });
    }
    showStep(3);
  }

  // ---------------------------------------------------------------- snapshot

  // A serializable description of everything the user built. Stored on the
  // design row so the piece can be re-opened later, and on the listing so
  // anyone can remix it.
  function buildSnapshot() {
    var positions = {};
    ['Front', 'Back', 'Sleeve'].forEach(function (pos) {
      var d = designs[pos];
      var t = texts[pos];
      if (!d && !t) return;
      positions[pos] = {
        design: d ? { dataUrl: d.dataUrl || null, fx: d.fx, fy: d.fy, scale: d.scale, rotation: d.rotation } : null,
        text: t ? { text: t.text, font: t.font, color: t.color, fx: t.fx, fy: t.fy, scale: t.scale, rotation: t.rotation } : null
      };
    });
    return {
      version: 1,
      product_id: currentProduct ? currentProduct.id : null,
      product_name: currentProduct ? currentProduct.name : '',
      color: selectedColor ? colorName(selectedColor) : '',
      color_image: currentProduct ? colorImage(selectedColor, currentProduct) : '',
      size: selectedSize,
      positions: positions
    };
  }

  function hasArtwork() {
    return ['Front', 'Back', 'Sleeve'].some(function (p) { return designs[p] || texts[p]; });
  }

  // Rebuild the editor from a snapshot (used by ?remix=<listing id>).
  function applySnapshot(snap) {
    if (!snap || !snap.positions) return;
    Object.keys(snap.positions).forEach(function (pos) {
      var slot = snap.positions[pos];
      if (!slot) return;
      if (slot.text) texts[pos] = Object.assign({}, slot.text);
      if (slot.design && slot.design.dataUrl) {
        loadCanvasImage(slot.design.dataUrl, function (img) {
          designs[pos] = {
            img: img,
            fx: slot.design.fx, fy: slot.design.fy,
            scale: slot.design.scale, rotation: slot.design.rotation,
            fileName: 'remix.png',
            objectUrl: null,
            dataUrl: slot.design.dataUrl
          };
          drawPreview();
        });
      }
    });
    if (snap.size) selectedSize = snap.size;
    drawPreview();
  }

  // renderCustomize always marks the first colour/size active, which is right
  // for a fresh design but wrong when we restore a snapshot that picked
  // something else. Push the real selection back into the buttons.
  function syncSelectionUI() {
    var wanted = selectedColor ? colorName(selectedColor) : null;
    var colorBtns = $('custom-colors').querySelectorAll('.sm-pdp-color');
    for (var i = 0; i < colorBtns.length; i++) {
      var label = colorBtns[i].querySelector('.sm-pdp-color-label');
      colorBtns[i].classList.toggle('active', !!label && label.textContent === wanted);
    }

    var sizeBtns = $('custom-sizes').querySelectorAll('.sm-pdp-size');
    for (var j = 0; j < sizeBtns.length; j++) {
      sizeBtns[j].classList.toggle('active', sizeBtns[j].getAttribute('data-size') === selectedSize);
    }

    var posBtns = $('custom-positions').querySelectorAll('.sm-pdp-size');
    for (var k = 0; k < posBtns.length; k++) {
      posBtns[k].classList.toggle('active', posBtns[k].getAttribute('data-position') === selectedPosition);
    }
  }

  // Rebuild the whole editor around a snapshot: fetch its base garment, restore
  // the colour/size the designer chose, then drop the artwork back on.
  function openSnapshot(snap, message) {
    if (!snap) { SM.toast('That design cannot be opened.', 'error'); return loadProducts(); }
    var productId = snap.product_id;
    if (!productId) { SM.toast('That design has no base garment.', 'error'); return loadProducts(); }

    return SM.api('/api/products/' + productId).then(function (p) {
      var colors = (p.colors && p.colors.length) ? p.colors : [{ name: 'Default', hex: '#cccccc', image_url: p.image_url }];
      currentProduct = p;
      // Prefer the colour the original designer used.
      var match = colors.filter(function (c) { return colorName(c) === snap.color; })[0];
      selectedColor = match || colors[0];
      selectedSize = snap.size || ((p.sizes && p.sizes[0]) || 'One Size');
      selectedPosition = Object.keys(snap.positions || {})[0] || 'Front';
      renderCustomize(p, colors);
      syncSelectionUI();
      loadGarment(colorImage(selectedColor, currentProduct));
      applySnapshot(snap);
      showStep(2);
      if (message) SM.toast(message);
    });
  }

  // Load someone else's published design into the editor.
  function loadRemix(listingId) {
    SM.api('/api/marketplace/' + listingId)
      .then(function (l) {
        return openSnapshot(l.design_snapshot, 'Remixing "' + l.title + '" — make it yours.');
      })
      .catch(function (err) {
        SM.toast(err.message || 'Could not load that design.', 'error');
        loadProducts();
      });
  }

  // Re-open one of your own saved drafts from My designs.
  function loadSavedDesign(designId) {
    SM.api('/api/designs/' + designId)
      .then(function (d) {
        return openSnapshot(d.canvas_data, 'Editing "' + d.name + '".');
      })
      .catch(function (err) {
        SM.toast(err.message || 'Could not load that design.', 'error');
        loadProducts();
      });
  }

  // ---------------------------------------------------------------- preview export

  // Exporting the composed canvas is best-effort by design: the customization
  // itself lives in buildSnapshot(), and losing a thumbnail must never cost the
  // user their cart line, their saved design or their listing.
  //
  // With canvasSafeSrc() in place this should always succeed. If it somehow does
  // not, we return null and the caller falls back to the garment's own image —
  // a real, displayable URL, never a broken or empty one.
  function exportPreview() {
    var canvas = $('custom-final-canvas');
    if (!canvas) return null;
    try {
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.error('[customize] canvas export failed:', err);
      return null;
    }
  }

  // The image we show for this design when no canvas export is available.
  function fallbackImage() {
    return (selectedColor && colorImage(selectedColor, currentProduct)) ||
      (currentProduct && currentProduct.image_url) || '';
  }

  // ---------------------------------------------------------------- cart

  function customCartItem() {
    var preview = exportPreview();
    if (!preview) {
      SM.toast('Preview image unavailable — using the product photo.', 'error');
    }
    return {
      product_id: null,          // made to order — never draws down shop stock
      name: currentProduct.name + ' (Custom)',
      price: currentProduct.price,
      image_url: preview || fallbackImage(),
      size: selectedSize,
      color: selectedColor ? colorName(selectedColor) : '',
      quantity: 1,
      meta: {
        source: 'customizer',
        base_product_id: currentProduct.id,
        position: selectedPosition,
        preview_ok: !!preview,
        snapshot: buildSnapshot()
      }
    };
  }

  function addCustomToCart() {
    if (!currentProduct) return;
    var btn = $('custom-addcart');
    btn.disabled = true;
    SM.addToCart(customCartItem())
      .then(function () { SM.toast('Added to your bag.'); })
      .catch(function (err) { SM.toast(err.message || 'Could not add to bag.', 'error'); })
      .then(function () { btn.disabled = false; });
  }

  // ---------------------------------------------------------------- save (draft)

  // Stores the design privately under My designs. Nothing is listed for sale
  // until the user publishes it — from here or from the marketplace page.
  function saveDesign() {
    if (!currentProduct) return;
    if (!SM.isLoggedIn()) {
      SM.toast('Please sign in to save your design.', 'error');
      setTimeout(function () {
        window.location.href = '/login.html?next=' + encodeURIComponent('/customize.html');
      }, 900);
      return;
    }
    if (!hasArtwork()) {
      SM.toast('Add some artwork or text before saving.', 'error');
      return;
    }

    var btn = $('custom-save');
    btn.disabled = true;

    var snapshot = buildSnapshot();

    // The thumbnail is a nicety; the design must save either way.
    uploadPreview()
      .then(function (thumbnailUrl) {
        return SM.api('/api/designs', {
          method: 'POST',
          body: JSON.stringify({
            name: currentProduct.name + ' — my version',
            canvas_data: snapshot,
            thumbnail_url: thumbnailUrl || fallbackImage(),
            product_type: 'other'
          })
        });
      })
      .then(function () { SM.toast('Saved to My designs.'); })
      .catch(function (err) { SM.toast(err.message || 'Could not save your design.', 'error'); })
      .then(function () { btn.disabled = false; });
  }

  // Render the canvas and store it as a real image file. Resolves to its URL,
  // or to null when either the export or the upload fails — callers then fall
  // back to the garment photo rather than losing the whole operation.
  function uploadPreview() {
    var dataUrl = exportPreview();
    if (!dataUrl) return Promise.resolve(null);
    return SM.api('/api/designs/preview', { method: 'POST', body: JSON.stringify({ data_url: dataUrl }) })
      .then(function (up) { return up.url; })
      .catch(function (err) {
        console.error('[customize] preview upload failed:', err);
        SM.toast('Preview image could not be stored — using the product photo.', 'error');
        return null;
      });
  }

  // ---------------------------------------------------------------- publish

  function publishError(msg) {
    var box = $('custom-publish-error');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function openPublish() {
    if (!currentProduct) return;
    if (!SM.isLoggedIn()) {
      SM.toast('Please sign in to publish your design.', 'error');
      setTimeout(function () {
        window.location.href = '/login.html?next=' + encodeURIComponent('/customize.html');
      }, 900);
      return;
    }
    if (!hasArtwork()) {
      SM.toast('Add some artwork or text before publishing.', 'error');
      return;
    }

    publishError('');
    $('custom-publish-thumb').src = exportPreview() || fallbackImage();
    $('custom-publish-title').value = currentProduct.name + ' — my version';
    $('custom-publish-price').value = Math.round(Number(currentProduct.price));
    $('custom-publish-price-hint').textContent = 'Base garment costs ' + SM.money(currentProduct.price) + '.';
    $('custom-publish-modal').hidden = false;
  }

  function closePublish() {
    $('custom-publish-modal').hidden = true;
  }

  // design preview -> uploaded image -> design row -> listing row
  function submitPublish() {
    var btn = $('custom-publish-submit');
    var title = $('custom-publish-title').value.trim();
    var price = Number($('custom-publish-price').value);

    if (!title) return publishError('Please give your design a title.');
    if (!isFinite(price) || price <= 0) return publishError('Enter a price greater than 0.');

    var tags = $('custom-publish-tags').value.split(',')
      .map(function (t) { return t.trim().toLowerCase(); })
      .filter(Boolean).slice(0, 8);

    var snapshot = buildSnapshot();

    btn.disabled = true;
    publishError('');

    // The listing requires an image_url, so fall back to the garment photo if
    // the canvas export or its upload fails — publishing still goes through.
    uploadPreview()
      .then(function (previewUrl) {
        var imageUrl = previewUrl || fallbackImage();
        return SM.api('/api/designs', {
          method: 'POST',
          body: JSON.stringify({
            name: title,
            canvas_data: snapshot,
            thumbnail_url: imageUrl,
            product_type: $('custom-publish-category').value
          })
        }).then(function (d) { return { url: imageUrl, design: d.design }; });
      })
      .then(function (ctx) {
        return SM.api('/api/marketplace', {
          method: 'POST',
          body: JSON.stringify({
            title: title,
            description: $('custom-publish-desc').value.trim(),
            price: price,
            image_url: ctx.url,
            size: selectedSize,
            color: selectedColor ? colorName(selectedColor) : '',
            category: $('custom-publish-category').value,
            tags: tags,
            design_id: ctx.design.id,
            base_product_id: currentProduct.id,
            design_snapshot: snapshot
          })
        });
      })
      .then(function (r) {
        closePublish();
        SM.toast('Published to the Community Marketplace.');
        window.location.href = '/marketplace-item.html?id=' + r.listing.id;
      })
      .catch(function (err) {
        publishError(err.message || 'Could not publish. Please try again.');
      })
      .then(function () { btn.disabled = false; });
  }

  function bindEvents() {
    on('sm-garment-retry', 'click', loadProducts);

    on('sm-garment-grid', 'click', function (e) {
      var btn = e.target.closest('.sm-garment-select');
      if (!btn) return;
      selectProduct(btn.getAttribute('data-id'));
    });

    on('custom-colors', 'click', function (e) {
      var btn = e.target.closest('.sm-pdp-color');
      if (!btn || !currentProduct) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var colors = (currentProduct.colors && currentProduct.colors.length) ? currentProduct.colors : null;
      if (!colors) return;
      var btns = this.querySelectorAll('.sm-pdp-color');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      btn.classList.add('active');
      selectedColor = colors[idx];
      loadGarment(colorImage(selectedColor, currentProduct));
    });

    on('custom-sizes', 'click', function (e) {
      var btn = e.target.closest('.sm-pdp-size');
      if (!btn) return;
      var btns = this.querySelectorAll('.sm-pdp-size');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      btn.classList.add('active');
      selectedSize = btn.getAttribute('data-size');
    });

    on('custom-positions', 'click', function (e) {
      var btn = e.target.closest('.sm-pdp-size');
      if (!btn) return;
      var btns = this.querySelectorAll('.sm-pdp-size');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      btn.classList.add('active');
      selectedPosition = btn.getAttribute('data-position');
      drawPreview();
    });

    on('custom-add-design', 'click', function () {
      $('custom-file-input').click();
    });

    on('custom-file-input', 'change', function () {
      var f = this.files && this.files[0];
      if (f) uploadDesign(f);
      this.value = '';
    });

    on('custom-size-minus', 'click', function () {
      var d = currentDesign();
      if (d) setDesignScale(d.scale - 0.1);
    });

    on('custom-size-plus', 'click', function () {
      var d = currentDesign();
      if (d) setDesignScale(d.scale + 0.1);
    });

    on('custom-size-slider', 'input', function () {
      setDesignScale(this.value / 100);
    });

    on('custom-rotate-left', 'click', function () {
      rotateDesign(-ROTATE_STEP);
    });

    on('custom-rotate-right', 'click', function () {
      rotateDesign(ROTATE_STEP);
    });

    on('custom-remove-design', 'click', removeDesign);

    on('custom-add-text', 'click', addText);

    on('custom-text-input', 'keydown', function (e) {
      if (e.key === 'Enter') addText();
    });

    on('custom-text-font', 'change', function () {
      var t = currentText();
      if (t) { t.font = this.value; drawPreview(); }
    });

    on('custom-text-color', 'input', function () {
      var t = currentText();
      if (t) { t.color = this.value; drawPreview(); }
    });

    on('custom-text-minus', 'click', function () {
      var t = currentText();
      if (t) setTextScale(t.scale - 0.1);
    });

    on('custom-text-plus', 'click', function () {
      var t = currentText();
      if (t) setTextScale(t.scale + 0.1);
    });

    on('custom-text-slider', 'input', function () {
      setTextScale(this.value / 100);
    });

    on('custom-text-rotate-left', 'click', function () {
      rotateText(-ROTATE_STEP);
    });

    on('custom-text-rotate-right', 'click', function () {
      rotateText(ROTATE_STEP);
    });

    on('custom-remove-text', 'click', removeText);

    on('custom-reset', 'click', function () {
      if (!currentProduct) return;
      var colors = (currentProduct.colors && currentProduct.colors.length) ? currentProduct.colors : null;
      selectedColor = colors ? colors[0] : null;
      selectedSize = (currentProduct.sizes && currentProduct.sizes.length) ? currentProduct.sizes[0] : 'One Size';
      selectedPosition = 'Front';
      clearAllDesigns();
      clearTexts();
      renderCustomize(currentProduct, colors || [{ name: 'Default', hex: '#cccccc', image_url: currentProduct.image_url }]);
      loadGarment(colorImage(selectedColor, currentProduct));
      SM.toast('Customization reset.');
    });

    on('custom-continue', 'click', continueToPreview);

    on('custom-edit', 'click', function () {
      showStep(2);
    });

    on('custom-choose-another', 'click', function () {
      clearAllDesigns();
      clearTexts();
      showStep(1);
      loadProducts();
    });

    on('custom-addcart', 'click', addCustomToCart);

    on('custom-save', 'click', saveDesign);
    on('custom-publish', 'click', openPublish);
    on('custom-publish-cancel', 'click', closePublish);
    on('custom-publish-submit', 'click', submitPublish);
    on('custom-publish-modal', 'click', function (e) {
      if (e.target === this) closePublish();
    });
    document.addEventListener('keydown', function (e) {
      var modal = $('custom-publish-modal');
      if (e.key === 'Escape' && modal && !modal.hidden) closePublish();
    });

    var previewCanvas = $('custom-preview-canvas');
    if (previewCanvas) bindCanvas(previewCanvas);

    window.addEventListener('resize', function () {
      var canvas = $('custom-preview-canvas');
      if (!canvas) return;
      var box = canvasBox(canvas);
      var d = currentDesign();
      var t = currentText();
      if (d) clampElement(d, box.w, box.h);
      if (t) clampElement(t, box.w, box.h);
      drawPreview();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!SM) {
      showGarmentError('Website failed to load. Please refresh.');
      return;
    }
    bindEvents();

    // ?remix=<listing id> opens someone else's published design;
    // ?design=<design id> re-opens one of your own saved drafts.
    var remix = SM.qs('remix');
    var design = SM.qs('design');
    if (remix) loadRemix(remix);
    else if (design) loadSavedDesign(design);
    else loadProducts();
  });
})();
