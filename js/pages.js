// ShopMax page rendering helpers (shared by category / marketplace / product pages).

(function () {
  'use strict';

  function productCardHTML(p) {
    var priceHTML = '';
    if (p.compare_at_price) {
      priceHTML = '<span class="sm-card-price">' + SM.money(p.price) +
        ' <small style="color:#999;text-decoration:line-through;font-weight:400">' + SM.money(p.compare_at_price) + '</small></span>';
    } else {
      priceHTML = '<span class="sm-card-price">' + SM.money(p.price) + '</span>';
    }
    var stars = '';
    if (p.rating) {
      var full = Math.round(p.rating);
      stars = '<div class="sm-card-rating">' + '★'.repeat(full) + '☆'.repeat(5 - full) + ' <small style="color:#999">' + Number(p.rating).toFixed(1) + '</small></div>';
    }
    var link = 'product.html?id=' + (p.slug || p.id);
    return '' +
      '<div class="col-lg-3 col-md-6 mb-4" data-aos="fade-up">' +
        '<div class="sm-product-card">' +
          '<a href="' + link + '" class="sm-card-img"><img src="' + SM.esc(p.image_url) + '" alt="' + SM.esc(p.name) + '"></a>' +
          '<div class="sm-card-body">' +
            '<div class="sm-card-cat">' + SM.esc(p.category) + '</div>' +
            '<h3 class="sm-card-title"><a href="' + link + '">' + SM.esc(p.name) + '</a></h3>' +
            priceHTML + stars +
            '<div class="sm-card-actions">' +
              '<a href="' + link + '" class="btn-sm-outline">View</a>' +
              '<button class="btn-sm-primary sm-add-btn" data-name="' + SM.esc(p.name) + '" data-price="' + p.price + '" data-image="' + SM.esc(p.image_url) + '" data-pid="' + (p.id || '') + '">Add</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function bindAddButtons(root) {
    root = root || document;
    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.sm-add-btn');
      if (!btn) return;
      e.preventDefault();
      var size = btn.getAttribute('data-size') || null;
      SM.addToCart({
        product_id: btn.getAttribute('data-pid') || null,
        name: btn.getAttribute('data-name'),
        price: Number(btn.getAttribute('data-price')),
        image_url: btn.getAttribute('data-image'),
        size: size,
        quantity: 1
      });
    });
  }

  function sortProducts(items, sort) {
    var arr = items.slice();
    if (sort === 'price-asc') arr.sort(function (a, b) { return a.price - b.price; });
    else if (sort === 'price-desc') arr.sort(function (a, b) { return b.price - a.price; });
    else if (sort === 'rating') arr.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    return arr;
  }

  function categoryPage(opts) {
    var grid = document.querySelector(opts.gridSelector);
    var emptyEl = document.querySelector(opts.emptySelector);
    var searchBox = document.querySelector(opts.searchSelector);
    var sortSel = document.querySelector(opts.sortSelector);
    var allItems = [];

    function render() {
      var items = allItems.slice();
      if (searchBox && searchBox.value.trim()) {
        var q = searchBox.value.trim().toLowerCase();
        items = items.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0; });
      }
      if (sortSel) items = sortProducts(items, sortSel.value);
      grid.innerHTML = items.map(productCardHTML).join('');
      if (emptyEl) emptyEl.style.display = items.length ? 'none' : 'block';
      if (window.AOS) AOS.refresh();
    }

    var params = '?category=' + opts.category + '&limit=100';
    // pre-fill search from URL (?q=)
    var urlQ = new URLSearchParams(window.location.search).get('q');
    if (urlQ && searchBox) { searchBox.value = urlQ; params += '&q=' + encodeURIComponent(urlQ); }

    SM.api('/api/products' + params).then(function (res) {
      allItems = Array.isArray(res) ? res : (res.products || []);
      render();
    }).catch(function () { if (emptyEl) emptyEl.style.display = 'block'; });

    if (searchBox) searchBox.addEventListener('input', render);
    if (sortSel) sortSel.addEventListener('change', render);
    bindAddButtons(grid);
  }

  // -------- Footer injector --------
  function injectFooter() {
    var mount = document.getElementById('sm-footer-mount');
    if (!mount) return;
    mount.innerHTML = '' +
      '<footer class="site-footer custom-border-top">' +
        '<div class="container">' +
          '<div class="row">' +
            '<div class="col-md-6 col-lg-3 mb-4 mb-lg-0">' +
              '<h3 class="footer-heading mb-4">ShopMax</h3>' +
              '<p style="color:#888;font-size:14px">Your destination for fashion, home goods, and one-of-a-kind custom designs made by our community.</p>' +
            '</div>' +
            '<div class="col-lg-5 ml-auto mb-5 mb-lg-0"><div class="row">' +
              '<div class="col-md-12"><h3 class="footer-heading mb-4">Quick Links</h3></div>' +
              '<div class="col-md-6 col-lg-4"><ul class="list-unstyled">' +
                '<li><a href="men.html">Men</a></li><li><a href="women.html">Women</a></li><li><a href="home-goods.html">Home</a></li></ul></div>' +
              '<div class="col-md-6 col-lg-4"><ul class="list-unstyled">' +
                '<li><a href="marketplace.html">Marketplace</a></li><li><a href="customize.html">Customize</a></li><li><a href="cart.html">Cart</a></li></ul></div>' +
              '<div class="col-md-6 col-lg-4"><ul class="list-unstyled">' +
                '<li><a href="about.html">About</a></li><li><a href="contact.html">Contact</a></li><li><a href="account.html">Account</a></li></ul></div>' +
            '</div></div>' +
            '<div class="col-md-6 col-lg-3"><div class="block-5 mb-5"><h3 class="footer-heading mb-4">Contact Info</h3>' +
              '<ul class="list-unstyled">' +
                '<li class="address">ShopMax Store, Alkapuri Vadodara-390019, Gujarat, India</li>' +
                '<li class="phone"><a href="tel:+919316012532">+91 93160 12532</a></li>' +
                '<li class="email">shopmaxcustomercare@gmail.com</li>' +
              '</ul></div></div>' +
          '</div>' +
          '<div class="row pt-5 mt-5 text-center"><div class="col-md-12"><p>Copyright &copy;' + new Date().getFullYear() + ' ShopMax. All rights reserved.</p></div></div>' +
        '</div>' +
      '</footer>';
  }

  window.SM = window.SM || {};
  window.SM.pages = {
    productCardHTML: productCardHTML,
    bindAddButtons: bindAddButtons,
    sortProducts: sortProducts,
    categoryPage: categoryPage,
    injectFooter: injectFooter
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFooter);
  else injectFooter();
})();
