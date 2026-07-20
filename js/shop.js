/* ShopMax — category listing page logic (men / women / home / shop.html).
   Reads ?id / ?q / ?sort / filters and renders product cards via the API. */

(function () {
  'use strict';

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var grid = document.getElementById('sm-product-grid');
    if (!grid) return; // not a listing page

    var category = grid.getAttribute('data-category'); // men | women | home | (none=all)
    var q = getQueryParam('q');

    // filter controls
    var sortSel = document.getElementById('sm-sort');
    var minIn = document.getElementById('sm-min');
    var maxIn = document.getElementById('sm-max');
    var applyBtn = document.getElementById('sm-apply-filters');

    var state = { category: category, q: q, sort: '', min: '', max: '' };

    // reflect ?q in the search box if present
    var qBox = document.getElementById('sm-q');
    if (qBox && q) qBox.value = q;

    async function render() {
      grid.innerHTML = '<div class="sm-loading col-12">Loading products…</div>';
      var params = [];
      if (state.category) params.push('category=' + encodeURIComponent(state.category));
      if (state.q) params.push('q=' + encodeURIComponent(state.q));
      if (state.sort) params.push('sort=' + encodeURIComponent(state.sort));
      if (state.min) params.push('min=' + encodeURIComponent(state.min));
      if (state.max) params.push('max=' + encodeURIComponent(state.max));
      try {
        var rows = await ShopMax.api('/api/products' + (params.length ? '?' + params.join('&') : ''));
        if (!rows.length) {
          grid.innerHTML = '<div class="sm-empty col-12"><h3>No products found</h3><p>Try adjusting your filters or search.</p></div>';
          return;
        }
        grid.innerHTML = rows.map(ShopMax.productCard).join('');
      } catch (e) {
        grid.innerHTML = '<div class="sm-empty col-12"><h3>Could not load products</h3><p>' + e.message + '</p></div>';
      }
    }

    if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    if (applyBtn) applyBtn.addEventListener('click', function () {
      state.min = minIn ? minIn.value : '';
      state.max = maxIn ? maxIn.value : '';
      state.q = qBox ? qBox.value : state.q;
      render();
    });
    if (qBox) qBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { state.q = qBox.value; render(); }
    });

    render();
  });
})();
