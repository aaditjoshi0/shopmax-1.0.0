/* Shared category-page logic (men / women / home / shop search results).
 * Reads `category` and optional `?q=` / `?sort=` from config on the page. */
(function () {
  'use strict';
  var SM = window.ShopMax;

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function load() {
    var cfg = window.SM_CATEGORY || {};
    var category = cfg.category;          // 'men' | 'women' | 'home' | undefined (all)
    var title = cfg.title || (category ? cap(category) : 'All Products');
    var blurb = cfg.blurb || '';

    if (cfg.setTitle) document.getElementById('sm-cat-title').textContent = title;
    if (blurb && document.getElementById('sm-cat-blurb')) document.getElementById('sm-cat-blurb').textContent = blurb;
    document.title = title + ' — ShopMax';

    var grid = document.getElementById('sm-grid');
    var sortSel = document.getElementById('sm-sort');
    var countEl = document.getElementById('sm-count');

    function fetchAndRender() {
      grid.className = 'row sm-loading';
      grid.innerHTML = 'Loading…';
      var params = new URLSearchParams();
      if (category) params.set('category', category);
      var q = SM.qs('q');
      if (q) {
        params.set('q', q);
        if (cfg.setTitle) document.getElementById('sm-cat-title').textContent = 'Results for "' + q + '"';
      }
      if (sortSel && sortSel.value) params.set('sort', sortSel.value);

      SM.api('/api/products?' + params.toString()).then(function (items) {
        if (countEl) countEl.textContent = items.length + ' product' + (items.length === 1 ? '' : 's');
        if (!items.length) {
          grid.className = 'sm-empty';
          grid.innerHTML = '<span class="icon icon-search"></span><h3>No products found</h3>' +
            '<p>Try a different search or browse <a href="/shop.html">all products</a>.</p>';
          return;
        }
        grid.className = 'row';
        grid.innerHTML = items.map(SM.productCard).join('');
      }).catch(function (err) {
        grid.className = 'sm-empty';
        grid.innerHTML = '<span class="icon icon-close2"></span><h3>Could not load products</h3><p>' + SM.escapeHtml(err.message) + '</p>';
      });
    }

    if (sortSel) sortSel.addEventListener('change', fetchAndRender);
    fetchAndRender();
  }

  document.addEventListener('DOMContentLoaded', load);
})();
