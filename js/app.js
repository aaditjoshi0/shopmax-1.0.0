/* ============================================================================
 * ShopMax shared frontend (app.js)
 *  - Injects the navbar (MEN / WOMEN / HOME / COMMUNITY-MARKETPLACE / CUSTOMIZE
 *    + search + user profile + live cart badge) into every page.
 *  - Manages auth state across pages.
 *  - Exposes a global `ShopMax` helper with API + UI utilities used by the
 *    per-page scripts (product.js, cart.js, customize.js, marketplace.js ...).
 *
 * Loaded as a normal <script> (no module) so it works on the static template.
 * ========================================================================== */

(function () {
  'use strict';

  var API = ''; // same origin

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw Object.assign(new Error(body.error || ('HTTP ' + r.status)), { body: body, status: r.status });
        return body;
      });
    });
  }

  function money(n) {
    return '\u20B9' + Number(n || 0).toFixed(2);
  }

  function qs(name, url) {
    url = url || window.location.search;
    return new URLSearchParams(url).get(name);
  }

  function starHtml(rating) {
    rating = Number(rating) || 0;
    var html = '<span class="star-rating">';
    for (var i = 1; i <= 5; i++) {
      html += '<span class="icon-star2 ' + (i <= Math.round(rating) ? 'text-warning' : 'text-muted') + '"></span>';
    }
    html += '</span>';
    return html;
  }

  function ratingDisplayHtml(rating, count) {
    rating = Number(rating) || 0;
    count = Number(count) || 0;
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<span class="icon-star2 ' + (i <= Math.round(rating) ? 'text-warning' : 'text-muted') + '"></span>';
    }
    return '<div class="sm-rating-display">' +
      '<span class="sm-rating-stars">' + stars + '</span>' +
      '<span class="sm-rating-text">' + rating.toFixed(1) + ' / 5</span>' +
      '<span class="sm-rating-count">(' + count + ' Rating' + (count !== 1 ? 's' : '') + ')</span>' +
    '</div>';
  }

  function ratingInputHtml(currentRating) {
    currentRating = Number(currentRating) || 0;
    var html = '<div class="sm-rating-input">';
    for (var i = 1; i <= 5; i++) {
      html += '<span class="sm-rating-star' + (i <= currentRating ? ' active' : '') + '" data-val="' + i + '">&#9733;</span>';
    }
    html += '</div>';
    return html;
  }

  function priceHtml(p) {
    if (p.compare_at_price && p.compare_at_price > p.price) {
      return '<strong class="item-price"><del>' + money(p.compare_at_price) + '</del> ' + money(p.price) + '</strong>';
    }
    return '<strong class="item-price">' + money(p.price) + '</strong>';
  }

  function stockHtml(p) {
    var stock = p.stock || 0;
    if (stock === 0) return '<span class="sm-stock-label sm-out-of-stock">Out of Stock</span>';
    if (stock <= 5) return '<span class="sm-stock-label sm-low-stock">Only ' + stock + ' left</span>';
    if (p.variants && p.variants.length > 0) {
      var publicVariants = p.variants.filter(function (v) { return v.status === 'published'; });
      if (publicVariants.length === 0) return '<span class="sm-stock-label sm-out-of-stock">Out of Stock</span>';
      var anyInStock = publicVariants.some(function (v) { return v.stock > 0; });
      if (!anyInStock) return '<span class="sm-stock-label sm-out-of-stock">Out of Stock</span>';
    }
    return '';
  }

  function productCard(p) {
    var hasVariants = p.variants && p.variants.length > 0;
    var oos = hasVariants
      ? p.variants.every(function (v) { return v.status !== 'published' || v.stock === 0; })
      : p.stock === 0;
    return '' +
      '<div class="col-lg-4 col-md-6 item-entry mb-4">' +
        '<a href="/product/' + p.id + '" class="product-item md-height bg-gray d-block' + (oos ? ' sm-product-oos' : '') + '">' +
          '<img src="' + p.image_url + '" alt="' + escapeHtml(p.name) + '" class="img-fluid">' +
          (oos ? '<div class="sm-oos-overlay">OUT OF STOCK</div>' : '') +
        '</a>' +
        '<h2 class="item-title"><a href="/product/' + p.id + '">' + escapeHtml(p.name) + '</a></h2>' +
        priceHtml(p) +
        stockHtml(p) +
        (p.rating ? ratingDisplayHtml(p.rating, p.rating_count) : '') +
      '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- toast ----
  function toast(msg, kind) {
    var t = document.getElementById('sm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'sm-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'sm-toast show ' + (kind === 'error' ? 'sm-toast-error' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'sm-toast'; }, 2600);
  }

  // ---- auth state ----
  var currentUser = null;

  function isLoggedIn() { return !!currentUser; }

  function refreshAuth() {
    return api('/api/auth/me').then(function (res) {
      currentUser = res.user || null;
      return currentUser;
    }).catch(function () { currentUser = null; return null; });
  }

  function requireLogin(redirectTo) {
    if (currentUser) return true;
    window.location.href = '/login.html?next=' + encodeURIComponent(redirectTo || window.location.pathname);
    return false;
  }

  // ---- cart badge ----
  function refreshCartBadge() {
    return api('/api/cart').then(function (cart) {
      setBadge(cart.count || 0);
      return cart;
    }).catch(function () { setBadge(0); return { items: [], count: 0, subtotal: 0 }; });
  }

  function setBadge(n) {
    document.querySelectorAll('.js-cart-count').forEach(function (el) {
      el.textContent = n;
      el.style.display = n > 0 ? '' : 'none';
    });
  }

  // ---- addToCart helper used across pages ----
  function addToCart(item) {
    return api('/api/cart/items', { method: 'POST', body: JSON.stringify(item) })
      .then(function (cart) { setBadge(cart.count || 0); return cart; });
  }

  /* ----------------------------------------------------------------------
   * Navbar injection
   * -------------------------------------------------------------------- */
  function navItems() {
    return [
      { href: '/men.html',        label: 'Men' },
      { href: '/women.html',      label: 'Women' },
      { href: '/shop.html',       label: 'Home' },
      { href: '/shop.html',       label: 'Community Marketplace' },
      { href: '/shop.html',       label: 'Customize', accent: true }
    ];
  }

  function pathMatches(href) {
    var p = window.location.pathname;
    return p === href || p === href.replace(/\.html$/, '') || p.startsWith(href.replace(/\.html$/, '/'));
  }

  function buildNavbar() {
    var items = navItems();
    var lis = items.map(function (it) {
      var active = pathMatches(it.href) ? ' active' : '';
      var cls = it.accent ? ' class="sm-nav-cta' + active + '"' : (active ? ' class="active"' : '');
      return '<li' + cls + '><a href="' + it.href + '">' + it.label + '</a></li>';
    }).join('');

    var profileBtn = currentUser
      ? '<div class="sm-profile dropdown">' +
          '<a href="#" class="icons-btn d-inline-block" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
            '<span class="icon-user"></span>' +
          '</a>' +
          '<div class="dropdown-menu dropdown-menu-right">' +
            '<a class="dropdown-item disabled text-muted" href="#">Signed in as ' + escapeHtml(currentUser.name || currentUser.email) + '</a>' +
            '<div class="dropdown-divider"></div>' +
            '<a class="dropdown-item" href="/account.html">My Account</a>' +
            '<a class="dropdown-item" href="/account.html#orders">My Orders</a>' +
            '<a class="dropdown-item" href="/account.html#designs">My Designs</a>' +
            (currentUser.role === 'admin' ? '<div class="dropdown-divider"></div><a class="dropdown-item" href="/admin.html">Admin Panel</a>' : '') +
            '<div class="dropdown-divider"></div>' +
            '<a class="dropdown-item" href="#" id="sm-logout-link">Log out</a>' +
          '</div>' +
        '</div>'
      : '<a href="/login.html" class="icons-btn d-inline-block" title="Login / Sign up"><span class="icon-user"></span></a>';

    var html =
      '<div class="site-navbar bg-white">' +
        '<div class="sm-search-overlay js-search-close"></div>' +
        '<div class="sm-search-panel" id="sm-search-panel">' +
          '<div class="sm-search-panel-header">' +
            '<span class="icon-search"></span>' +
            '<form id="sm-search-form" action="/shop.html" method="get" autocomplete="off">' +
              '<input type="text" name="q" id="sm-search-input" class="sm-search-input" placeholder="Search">' +
            '</form>' +
            '<a href="#" class="sm-search-close-btn js-search-close"><span class="icon-close2"></span></a>' +
          '</div>' +
          '<div class="sm-search-body" id="sm-search-body">' +
            '<div id="sm-search-suggestions">' +
              '<h4 class="sm-search-label">POPULAR SEARCHES</h4>' +
              '<a href="/shop.html?q=summer+shorts" class="sm-search-item">SUMMER SHORTS</a>' +
              '<a href="/shop.html?q=shirt+men" class="sm-search-item">SHIRT MEN</a>' +
              '<a href="/shop.html?q=tops+%26+t-shirts+kids" class="sm-search-item">TOPS & T-SHIRTS KIDS</a>' +
              '<a href="/men.html" class="sm-search-item">MEN</a>' +
              '<a href="/women.html" class="sm-search-item">WOMEN</a>' +
            '</div>' +
            '<div id="sm-search-history" style="display:none;">' +
              '<div class="sm-search-history-header">' +
                '<h4 class="sm-search-label">SEARCH HISTORY</h4>' +
                '<a href="#" id="sm-clear-history" class="sm-clear-history">Clear all</a>' +
              '</div>' +
              '<div id="sm-search-history-list"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="container">' +
          '<div class="d-flex align-items-center justify-content-between">' +
            '<div class="logo"><div class="site-logo"><a href="/index.html" class="js-logo-clone"><img src="/images/logo.png" alt="ShopMax"></a></div></div>' +
            '<div class="main-nav d-none d-lg-block">' +
              '<nav class="site-navigation text-right text-md-center" role="navigation">' +
                '<ul class="site-menu js-clone-nav d-none d-lg-block">' + lis + '</ul>' +
              '</nav>' +
            '</div>' +
            '<div class="icons">' +
              '<a href="#" class="icons-btn d-inline-block js-search-open" title="Search"><span class="icon-search"></span></a>' +
              profileBtn +
              '<a href="/cart.html" class="icons-btn d-inline-block bag" title="Cart">' +
                '<span class="icon-shopping-bag"></span>' +
                '<span class="number js-cart-count">0</span>' +
              '</a>' +
              '<a href="#" class="site-menu-toggle js-menu-toggle ml-3 d-inline-block d-lg-none"><span class="icon-menu"></span></a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    return html;
  }

  function buildFooter() {
    return '' +
      '<footer class="site-footer custom-border-top">' +
        '<div class="container">' +
          '<div class="row">' +
            '<div class="col-md-6 col-lg-3 mb-4 mb-lg-0">' +
              '<h3 class="footer-heading mb-4"><img src="/images/logo.png" alt="ShopMax" style="height:55px;width:auto;"></h3>' +
              '<p>Design it, wear it, sell it. ShopMax is a store + community marketplace where anyone can customize clothing and sell their designs.</p>' +
            '</div>' +
            '<div class="col-lg-5 ml-auto mb-5 mb-lg-0">' +
              '<div class="row">' +
                '<div class="col-md-12"><h3 class="footer-heading mb-4">Quick Links</h3></div>' +
                '<div class="col-md-6 col-lg-4"><ul class="list-unstyled">' +
                  '<li><a href="/men.html">Men</a></li>' +
                  '<li><a href="/women.html">Women</a></li>' +
                  '<li><a href="/shop.html">All Products</a></li>' +
                  '<li><a href="/contact.html">Contact</a></li>' +
                '</ul></div>' +
                '<div class="col-md-6 col-lg-4"><ul class="list-unstyled">' +
                  '<li><a href="/cart.html">Cart</a></li>' +
                  '<li><a href="/return-policy.html">Return Policy</a></li>' +
                  '<li><a href="/refund-policy.html">Refund Policy</a></li>' +
                  '<li><a href="/delivery-policy.html">Delivery Policy</a></li>' +
                '</ul></div>' +
              '</div>' +
            '</div>' +
            '<div class="col-md-6 col-lg-3">' +
              '<div class="block-5 mb-5">' +
                '<h3 class="footer-heading mb-4">Contact Info</h3>' +
                '<ul class="list-unstyled">' +
                  '<li class="address">ShopMax Store, Alkapuri Vadodara-390019, Gujarat, India</li>' +
                  '<li class="phone"><a href="tel:+919316012532">+91 9316012532</a></li>' +
                  '<li class="email">shopmaxcustomercare@gmail.com</li>' +
                '</ul>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="row pt-5 mt-5 text-center"><div class="col-md-12">' +
            '<p>Copyright &copy;<script>document.write(new Date().getFullYear());</script> ShopMax. All rights reserved.</p>' +
          '</div></div>' +
        '</div>' +
      '</footer>';
  }

  function mountChrome() {
    var navHost = document.querySelector('[data-sm-navbar]');
    var footerHost = document.querySelector('[data-sm-footer]');

    if (navHost) navHost.innerHTML = buildNavbar();
    if (footerHost) footerHost.innerHTML = buildFooter();

    // Populate mobile menu (main.js runs before navbar exists, so clones fail)
    var logoClone = document.querySelector('.js-logo-clone');
    var mobileLogo = document.querySelector('.site-mobile-menu-logo');
    if (logoClone && mobileLogo && !mobileLogo.querySelector('img')) {
      mobileLogo.appendChild(logoClone.cloneNode(true));
    }
    var navClone = document.querySelector('.js-clone-nav');
    var mobileBody = document.querySelector('.site-mobile-menu-body');
    if (navClone && mobileBody && mobileBody.children.length === 0) {
      var navWrap = navClone.cloneNode(true);
      navWrap.className = 'site-nav-wrap';
      mobileBody.appendChild(navWrap);
    }

    initSearchPanel();
    bindNavEvents();
  }

  function initSearchPanel() {
    var openBtn = document.querySelector('.js-search-open');
    var panel = document.getElementById('sm-search-panel');
    var overlay = document.querySelector('.sm-search-overlay');
    var input = document.getElementById('sm-search-input');
    var historyList = document.getElementById('sm-search-history-list');
    var historyWrap = document.getElementById('sm-search-history');
    var clearBtn = document.getElementById('sm-clear-history');

    function openSearch() {
      if (!panel) return;
      panel.classList.add('active');
      if (overlay) overlay.classList.add('active');
      setTimeout(function () { if (input) input.focus(); }, 350);
      renderHistory();
    }
    function closeSearch() {
      if (!panel) return;
      panel.classList.remove('active');
      if (overlay) overlay.classList.remove('active');
      if (input) { input.value = ''; input.blur(); }
    }

    if (openBtn) openBtn.addEventListener('click', function (e) { e.preventDefault(); openSearch(); });

    document.querySelectorAll('.js-search-close').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); closeSearch(); });
    });
    if (overlay) overlay.addEventListener('click', closeSearch);

    // Search history
    function getHistory() {
      try { return JSON.parse(localStorage.getItem('sm-search-history') || '[]'); } catch (e) { return []; }
    }
    function saveHistory(term) {
      if (!term || !term.trim()) return;
      var h = getHistory().filter(function (t) { return t.toLowerCase() !== term.toLowerCase(); });
      h.unshift(term.trim());
      if (h.length > 8) h = h.slice(0, 8);
      localStorage.setItem('sm-search-history', JSON.stringify(h));
    }
    function removeHistoryItem(term) {
      var h = getHistory().filter(function (t) { return t.toLowerCase() !== term.toLowerCase(); });
      localStorage.setItem('sm-search-history', JSON.stringify(h));
      renderHistory();
    }
    function renderHistory() {
      if (!historyList || !historyWrap) return;
      var h = getHistory();
      if (h.length === 0) { historyWrap.style.display = 'none'; return; }
      historyWrap.style.display = 'block';
      historyList.innerHTML = h.map(function (t) {
        return '<div class="sm-search-history-item">' +
          '<a href="/shop.html?q=' + encodeURIComponent(t) + '" class="sm-search-item">' + escapeHtml(t) + '</a>' +
          '<button type="button" class="sm-history-delete" data-term="' + escapeHtml(t) + '">&times;</button>' +
        '</div>';
      }).join('');
      historyList.querySelectorAll('.sm-history-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          removeHistoryItem(this.getAttribute('data-term'));
        });
      });
    }

    if (clearBtn) clearBtn.addEventListener('click', function (e) {
      e.preventDefault();
      localStorage.removeItem('sm-search-history');
      renderHistory();
    });

    // Save search on submit
    var form = document.getElementById('sm-search-form');
    if (form) form.addEventListener('submit', function () {
      if (input && input.value.trim()) saveHistory(input.value.trim());
    });

    // Expose openSearch for rebind
    window._smOpenSearch = openSearch;
    window._smCloseSearch = closeSearch;
  }

  function bindNavEvents() {
    var logoutLink = document.getElementById('sm-logout-link');
    if (logoutLink) logoutLink.addEventListener('click', function (e) {
      e.preventDefault();
      api('/api/auth/logout', { method: 'POST' }).then(function () {
        currentUser = null;
        window.location.href = '/index.html';
      });
    });
  }

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', function () {
    mountChrome();
    refreshAuth().then(function () {
      // re-render profile area once auth is known, then refresh badge
      var navHost = document.querySelector('[data-sm-navbar]');
      if (navHost) navHost.innerHTML = buildNavbar();
      bindChromeAgain();
      refreshCartBadge();
    });
  });

  // rebind handlers that live in the re-rendered navbar
  function bindChromeAgain() {
    initSearchPanel();
    bindNavEvents();
  }

  // expose
  window.ShopMax = {
    api: api,
    money: money,
    qs: qs,
    escapeHtml: escapeHtml,
    starHtml: starHtml,
    ratingDisplayHtml: ratingDisplayHtml,
    ratingInputHtml: ratingInputHtml,
    priceHtml: priceHtml,
    productCard: productCard,
    toast: toast,
    addToCart: addToCart,
    refreshCartBadge: refreshCartBadge,
    refreshAuth: refreshAuth,
    isLoggedIn: isLoggedIn,
    requireLogin: requireLogin,
    get user() { return currentUser; }
  };
})();
