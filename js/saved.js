/* ShopMax — unified SAVED page.
 *
 * One page, two internal tabs — switch without leaving the page:
 *   Wishlist        -> /api/marketplace/liked/list  (the heart on a listing)
 *   Saved for later -> /api/marketplace/saved/list  (the bookmark on a listing)
 *
 * The two lists are independent: a listing can live in both, and removing it
 * from one never touches the other. This file reuses the marketplace card
 * glyphs, the optimistic like/save toggle handler and the add-to-bag helper so
 * heart/bookmark state and counts stay in lock-step with the marketplace grid
 * and the listing detail page — no duplicate APIs, no duplicate tables.
 */

(function () {
  'use strict';

  var SM = window.ShopMax;
  if (!SM || !SM.marketplace) return;          // marketplace.js exports the shared helpers

  var heartIcon = SM.marketplace.heartIcon;
  var saveIcon = SM.marketplace.saveIcon;

  var state = {
    tab: 'wishlist',                            // 'wishlist' | 'saved'
    items: { wishlist: [], saved: [] },
    loaded: { wishlist: false, saved: false },
    error: { wishlist: null, saved: null }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return SM.escapeHtml(String(s == null ? '' : s)); }

  // Up to two initials — the fallback shown when a thumbnail is missing.
  function initialsOf(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    var letters = '';
    for (var i = 0; i < words.length && letters.length < 2; i++) letters += words[i][0];
    return (letters || 'SM').toUpperCase();
  }

  function thumbHTML(url, alt, initials) {
    if (!url) return '<span class="sm-mk-init">' + esc(initials) + '</span>';
    return '<img src="' + esc(url) + '" alt="' + esc(alt) + '" class="img-fluid sm-mk-thumb" data-init="' +
      esc(initials) + '" onerror="this.outerHTML = smInitFallback(this)">';
  }

  // kind: 'like' (Wishlist tab) | 'save' (Saved-for-later tab).
  // Each card shows only the action that owns that tab, so removing it from
  // one list can never affect the other.
  function savedCardHTML(l, kind) {
    var href = '/marketplace-item.html?id=' + l.id;
    var on = kind === 'like' ? l.liked : l.saved;
    var btn = kind === 'like'
      ? '<button class="sm-mk-icon sm-mk-like' + (on ? ' on' : '') + '" data-act="like" data-id="' + l.id + '"' +
          ' title="' + (on ? 'Remove from wishlist' : 'Add to wishlist') + '" aria-label="Remove from wishlist">' +
          heartIcon(on) + '</button>'
      : '<button class="sm-mk-icon sm-mk-save' + (on ? ' on' : '') + '" data-act="save" data-id="' + l.id + '"' +
          ' title="' + (on ? 'Remove from saved' : 'Save for later') + '" aria-label="Remove from saved">' +
          saveIcon(on) + '</button>';

    return '' +
      '<div class="col-lg-3 col-md-4 col-6 item-entry mb-4 sm-mk-card" data-id="' + l.id + '">' +
        '<div style="position:relative">' +
          '<div class="sm-mk-actions">' + btn + '</div>' +
          '<a href="' + href + '" class="product-item md-height bg-gray d-block">' +
            thumbHTML(l.image_url, l.title, initialsOf(l.title)) +
          '</a>' +
        '</div>' +
        '<div class="sm-mk-designer">by ' + esc(l.designer_name) + '</div>' +
        '<h2 class="item-title mb-1"><a href="' + href + '">' + esc(l.title) + '</a></h2>' +
        '<strong class="product-price">' + SM.money(l.price) + '</strong>' +
        '<div class="sm-mk-meta"><span data-role="likes">♥ ' + (l.likes_count || 0) + '</span><span>◉ ' + (l.views || 0) + '</span></div>' +
        '<button class="btn btn-black btn-sm rounded-0 mt-2 js-saved-add-bag" data-id="' + l.id + '">Add to bag</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------- states

  function emptyHTML() {
    var msg = state.tab === 'wishlist'
      ? ['No favorites yet.', 'Tap the heart on products you love.']
      : ['No saved items yet.', 'Bookmark products to find them later.'];
    var icon = state.tab === 'wishlist' ? 'icon-heart-o' : 'icon-bookmark-o';
    return '<div class="col-12 sm-empty">' +
      '<span class="icon ' + icon + '"></span>' +
      '<h3 class="h5 text-black mb-2">' + msg[0] + '</h3>' +
      '<p>' + msg[1] + '</p>' +
      '<a href="/marketplace.html" class="btn btn-black rounded-0 mt-2">Browse the marketplace</a>' +
      '</div>';
  }

  function showSignIn() {
    var here = window.location.pathname + window.location.search;
    $('sm-saved-grid').innerHTML = '<div class="col-12 sm-empty">' +
      '<span class="icon icon-user-o"></span>' +
      '<h3 class="h5 text-black mb-2">Sign in to see your saved items</h3>' +
      '<p>Your wishlist and saved items live with your account.</p>' +
      '<a href="/login.html?next=' + encodeURIComponent(here) + '" class="btn btn-black rounded-0 mt-2">Sign in</a>' +
      '</div>';
    if ($('sm-saved-count')) $('sm-saved-count').textContent = '';
  }

  function showError(err) {
    $('sm-saved-grid').innerHTML = '<div class="col-12 sm-empty">' +
      '<h3 class="h5 text-black mb-2">Could not load this list</h3>' +
      '<p>' + esc(err && err.message ? err.message : 'Please try again.') + '</p>' +
      '<button class="btn btn-outline-black rounded-0 mt-2" id="sm-saved-retry">Retry</button>' +
      '</div>';
    var retry = $('sm-saved-retry');
    if (retry) retry.addEventListener('click', function () { loadTab(state.tab).then(render); });
  }

  // ---------------------------------------------------------------- loading

  function feedUrl(tab) {
    return tab === 'wishlist' ? '/api/marketplace/liked/list' : '/api/marketplace/saved/list';
  }

  function loadTab(tab) {
    return SM.api(feedUrl(tab)).then(function (r) {
      state.items[tab] = (r && r.items) || [];
      state.loaded[tab] = true;
      state.error[tab] = null;
    }).catch(function (err) {
      state.items[tab] = [];
      state.loaded[tab] = true;
      state.error[tab] = err;
    });
  }

  function loadAll() {
    $('sm-saved-grid').innerHTML = '<div class="col-12 sm-loading">Loading&hellip;</div>';
    // Load the visible tab first so the page paints fastest, then warm the
    // other tab in the background so the first switch is instant.
    return loadTab(state.tab).then(function () {
      render();
      refreshBadge();
      var other = state.tab === 'wishlist' ? 'saved' : 'wishlist';
      loadTab(other).then(function () { refreshBadge(); if (state.tab === other) render(); });
    });
  }

  // ---------------------------------------------------------------- render

  function render() {
    var grid = $('sm-saved-grid');
    var countEl = $('sm-saved-count');
    if (!grid) return;

    var err = state.error[state.tab];
    if (err) {
      if (err.status === 401) return showSignIn();
      return showError(err);
    }

    var items = state.items[state.tab];
    if (!items.length) {
      grid.innerHTML = emptyHTML();
      if (countEl) countEl.textContent = '0 ' + noun(state.tab);
      refreshBadge();
      return;
    }

    var kind = state.tab === 'wishlist' ? 'like' : 'save';
    grid.innerHTML = items.map(function (l) { return savedCardHTML(l, kind); }).join('');
    if (countEl) countEl.textContent = items.length + ' ' + noun(state.tab);
    refreshBadge();
  }

  function noun(tab) { return tab === 'wishlist' ? (state.items[tab].length === 1 ? 'favorite' : 'favorites') : (state.items[tab].length === 1 ? 'item' : 'items'); }

  function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab;
    document.querySelectorAll('.sm-saved-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    if (state.loaded[tab]) {
      render();
    } else {
      $('sm-saved-grid').innerHTML = '<div class="col-12 sm-loading">Loading&hellip;</div>';
      if ($('sm-saved-count')) $('sm-saved-count').textContent = '';
      loadTab(tab).then(render);
    }
  }

  // ---------------------------------------------------------------- actions

  function findItem(id) {
    var pool = state.items[state.tab];
    for (var i = 0; i < pool.length; i++) if (String(pool[i].id) === String(id)) return pool[i];
    return null;
  }

  function removeCard(id) {
    state.items[state.tab] = state.items[state.tab].filter(function (l) { return String(l.id) !== String(id); });
    render();
  }

  function refreshBadge() {
    var total = state.items.wishlist.length + state.items.saved.length;
    if (typeof SM.setSavedBadge === 'function') SM.setSavedBadge(total);
  }

  // ---------------------------------------------------------------- wiring

  function bind() {
    var tabs = $('sm-saved-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var t = e.target.closest('.sm-saved-tab');
      if (t) switchTab(t.getAttribute('data-tab'));
    });

    var grid = $('sm-saved-grid');
    if (!grid) return;

    // Reuse the marketplace optimistic toggle handler: it flips the glyph,
    // calls /api/marketplace/:id/like|save, rolls back on error, and reports
    // back via onChange so we can drop the card from this list immediately.
    SM.marketplace.bindToggles(grid, function (act, id, r) {
      if (!r.on) {
        if (state.tab === 'wishlist' && act === 'like') removeCard(id);
        if (state.tab === 'saved' && act === 'save') removeCard(id);
        SM.toast(act === 'like' ? 'Removed from your wishlist.' : 'Removed from saved for later.');
      } else {
        SM.toast(act === 'like' ? 'Added to your wishlist.' : 'Saved for later.');
      }
      refreshBadge();
      document.dispatchEvent(new CustomEvent('sm-saved-changed', { detail: { act: act, id: id, on: r.on } }));
    });

    // Add-to-bag mirrors the listing detail page so the cart line item stays a
    // marketplace line item (meta.source = 'marketplace'). Does not touch stock.
    grid.addEventListener('click', function (e) {
      var bag = e.target.closest && e.target.closest('.js-saved-add-bag');
      if (!bag) return;
      var id = bag.getAttribute('data-id');
      var l = findItem(id);
      if (!l) return;
      bag.disabled = true;
      SM.addToCart({
        name: l.title,
        price: l.price,
        image_url: l.image_url,
        size: l.size || null,
        color: l.color || '',
        quantity: 1,
        meta: {
          source: 'marketplace',
          listing_id: l.id,
          design_id: l.design_id || null,
          designer_name: l.designer_name
        }
      })
        .then(function () { SM.toast('Added to your bag.'); })
        .catch(function (err) { SM.toast(err.message || 'Could not add to bag.', 'error'); })
        .then(function () { bag.disabled = false; });
    });
  }

  // ---------------------------------------------------------------- boot

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('sm-saved-grid')) return;

    // ?tab=saved | ?tab=wishlist deep-link into one of the two tabs.
    var requested = SM.qs('tab');
    if (requested === 'saved' || requested === 'wishlist') {
      state.tab = requested;
      document.querySelectorAll('.sm-saved-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === requested);
      });
    }

    bind();

    // refreshAuth() resolves currentUser before we decide whether to require a
    // login — avoids a race where the page boots before /api/auth/me returns.
    SM.refreshAuth().then(function (user) {
      if (!user) { showSignIn(); return; }
      loadAll();
    }).catch(function () { showSignIn(); });
  });
})();
