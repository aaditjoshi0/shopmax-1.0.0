/* ShopMax — Community Marketplace grid.
 *
 * Four feeds share one grid: Explore (public), My designs, Saved, Liked.
 * The card renderer and the like/save toggle handler are exported on
 * SM.marketplace so the detail page reuses them instead of duplicating markup.
 */

(function () {
  'use strict';

  var SM = window.ShopMax;
  var PAGE_SIZE = 24;

  var state = {
    feed: 'explore',
    q: '',
    category: '',
    designer: '',
    sort: 'latest',
    page: 1,
    total: 0,
    items: [],
    drafts: []          // saved designs the user has not published yet
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return SM.escapeHtml(String(s == null ? '' : s)); }

  // Up to two initials from a name — the fallback shown when a thumbnail is
  // missing or cannot load (never a broken-image icon).
  function initialsOf(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    var letters = '';
    for (var i = 0; i < words.length && letters.length < 2; i++) letters += words[i][0];
    return (letters || 'SM').toUpperCase();
  }

  // Inline onerror hook: swaps a failed thumbnail for an initials tile.
  // Declared globally so the <img> markup can reference it directly; the
  // helper is shared by every card renderer (marketplace grid, related items).
  window.smInitFallback = function (img) {
    var holder = document.createElement('span');
    holder.className = 'sm-mk-init';
    holder.textContent = (img && img.getAttribute && img.getAttribute('data-init')) || 'SM';
    return holder.outerHTML;
  };

  // A thumbnail <img> that can never end up as a broken-image icon: no URL at
  // all renders the initials tile immediately; a failed load swaps to it too.
  function thumbHTML(url, alt, initials) {
    if (!url) return '<span class="sm-mk-init">' + esc(initials) + '</span>';
    return '<img src="' + esc(url) + '" alt="' + esc(alt) + '" class="img-fluid sm-mk-thumb" data-init="' +
      esc(initials) + '" onerror="this.outerHTML = smInitFallback(this)">';
  }

  // Filled vs outline glyphs from the theme's icomoon set.
  function heartIcon(on) { return '<span class="icon-heart' + (on ? '' : '-o') + '"></span>'; }
  function saveIcon(on) { return '<span class="icon-bookmark' + (on ? '' : '-o') + '"></span>'; }

  // ---------------------------------------------------------------- card

  function cardHTML(l) {
    var badge = '';
    if (l.is_mine) badge = '<span class="sm-mk-badge mine">Yours</span>';
    else if (l.status === 'hidden') badge = '<span class="sm-mk-badge">Hidden</span>';

    var href = '/marketplace-item.html?id=' + l.id;

    return '' +
      '<div class="col-lg-4 col-md-6 item-entry mb-5 sm-mk-card" data-id="' + l.id + '">' +
        '<div style="position:relative">' +
          badge +
          '<div class="sm-mk-actions">' +
            '<button class="sm-mk-icon sm-mk-like' + (l.liked ? ' on' : '') + '" data-act="like" data-id="' + l.id + '"' +
              ' title="' + (l.liked ? 'Unlike' : 'Like this design') + '" aria-label="Like">' +
              heartIcon(l.liked) +
            '</button>' +
            '<button class="sm-mk-icon sm-mk-save' + (l.saved ? ' on' : '') + '" data-act="save" data-id="' + l.id + '"' +
              ' title="' + (l.saved ? 'Remove from wishlist' : 'Save to wishlist') + '" aria-label="Save">' +
              saveIcon(l.saved) +
            '</button>' +
          '</div>' +
          '<a href="' + href + '" class="product-item md-height bg-gray d-block">' +
            thumbHTML(l.image_url, l.title, initialsOf(l.title)) +
          '</a>' +
        '</div>' +
        '<div class="sm-mk-designer">by ' + esc(l.designer_name) + '</div>' +
        '<h2 class="item-title mb-1"><a href="' + href + '">' + esc(l.title) + '</a></h2>' +
        '<strong class="product-price">' + SM.money(l.price) + '</strong>' +
        '<div class="sm-mk-meta">' +
          '<span data-role="likes">♥ ' + (l.likes_count || 0) + '</span>' +
          '<span>◉ ' + (l.views || 0) + '</span>' +
        '</div>' +
      '</div>';
  }

  // A saved-but-unpublished design. Same shape as a card so the grid stays
  // visually consistent, but with draft actions instead of like/save.
  function draftCardHTML(d) {
    return '' +
      '<div class="col-lg-4 col-md-6 item-entry mb-5 sm-mk-card" data-draft="' + d.id + '">' +
        '<div style="position:relative">' +
          '<span class="sm-mk-badge">Draft</span>' +
          '<div class="product-item md-height bg-gray d-block">' +
            thumbHTML(d.thumbnail_url, d.name, initialsOf(d.name)) +
          '</div>' +
        '</div>' +
        '<div class="sm-mk-designer">Saved ' + new Date(d.created_at).toLocaleDateString() + '</div>' +
        '<h2 class="item-title mb-1">' + esc(d.name) + '</h2>' +
        '<div class="sm-mk-meta mb-2">Not published yet</div>' +
        '<button class="btn btn-black btn-sm rounded-0" data-draft-publish="' + d.id + '">Publish</button> ' +
        '<a class="btn btn-outline-black btn-sm rounded-0" href="/customize.html?design=' + d.id + '">Edit</a> ' +
        '<button class="btn btn-link btn-sm text-danger" data-draft-delete="' + d.id + '">Delete</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------- draft publishing

  var publishingDraft = null;

  function draftError(msg) {
    var box = $('sm-mk-publish-error');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function openDraftPublish(id) {
    var d = state.drafts.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!d) return;
    publishingDraft = d;
    draftError('');
    var pt = $('sm-mk-publish-thumb');
    if (pt) {
      if (d.thumbnail_url) {
        pt.hidden = false;
        pt.onerror = function () { pt.hidden = true; };   // never show a broken icon
        pt.src = d.thumbnail_url;
      } else {
        pt.hidden = true;
      }
    }
    $('sm-mk-publish-title').value = d.name || '';
    $('sm-mk-publish-price').value = '';
    $('sm-mk-publish-desc').value = '';
    $('sm-mk-publish-tags').value = '';
    $('sm-mk-publish-modal').hidden = false;
  }

  function closeDraftPublish() {
    $('sm-mk-publish-modal').hidden = true;
    publishingDraft = null;
  }

  function submitDraftPublish() {
    if (!publishingDraft) return;
    var d = publishingDraft;
    var title = $('sm-mk-publish-title').value.trim();
    var price = Number($('sm-mk-publish-price').value);
    if (!title) return draftError('Please give your design a title.');
    if (!isFinite(price) || price <= 0) return draftError('Enter a price greater than 0.');

    var snap = d.canvas_data || {};
    var btn = $('sm-mk-publish-submit');
    btn.disabled = true;
    draftError('');

    SM.api('/api/marketplace', {
      method: 'POST',
      body: JSON.stringify({
        title: title,
        description: $('sm-mk-publish-desc').value.trim(),
        price: price,
        image_url: d.thumbnail_url,
        size: snap.size || null,
        color: snap.color || '',
        category: $('sm-mk-publish-category').value,
        tags: $('sm-mk-publish-tags').value.split(',')
          .map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean).slice(0, 8),
        design_id: d.id,
        base_product_id: snap.product_id || null,
        design_snapshot: snap
      })
    })
      .then(function (r) {
        closeDraftPublish();
        SM.toast('Published to the Community Marketplace.');
        window.location.href = '/marketplace-item.html?id=' + r.listing.id;
      })
      .catch(function (err) { draftError(err.message || 'Could not publish.'); })
      .then(function () { btn.disabled = false; });
  }

  function bindDraftActions(root) {
    root.addEventListener('click', function (e) {
      var pub = e.target.closest && e.target.closest('[data-draft-publish]');
      if (pub) { openDraftPublish(pub.getAttribute('data-draft-publish')); return; }

      var del = e.target.closest && e.target.closest('[data-draft-delete]');
      if (!del) return;
      var id = del.getAttribute('data-draft-delete');
      if (!window.confirm('Delete this saved design? This cannot be undone.')) return;
      del.disabled = true;
      SM.api('/api/designs/' + id, { method: 'DELETE' })
        .then(function () {
          state.drafts = state.drafts.filter(function (x) { return String(x.id) !== String(id); });
          SM.toast('Design deleted.');
          render(false);
        })
        .catch(function (err) {
          del.disabled = false;
          SM.toast(err.message || 'Could not delete.', 'error');
        });
    });
  }

  // ---------------------------------------------------------------- like / save

  // Optimistic toggle: flip the button immediately, roll back if the call fails.
  // Delegated from a root element so it works for cards rendered at any time.
  function bindToggles(root, onChange) {
    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act="like"],[data-act="save"]');
      if (!btn) return;
      e.preventDefault();

      var act = btn.getAttribute('data-act');
      if (!SM.isLoggedIn()) {
        SM.toast('Please sign in to ' + (act === 'like' ? 'like' : 'save') + ' designs.', 'error');
        setTimeout(function () {
          window.location.href = '/login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search);
        }, 900);
        return;
      }

      var id = btn.getAttribute('data-id');
      var wasOn = btn.classList.contains('on');
      var card = btn.closest('.sm-mk-card') || document;
      var likesEl = card.querySelector ? card.querySelector('[data-role="likes"]') : null;

      btn.disabled = true;
      btn.classList.toggle('on', !wasOn);
      btn.classList.add('pop');
      setTimeout(function () { btn.classList.remove('pop'); }, 300);
      btn.innerHTML = act === 'like' ? heartIcon(!wasOn) : saveIcon(!wasOn);

      SM.api('/api/marketplace/' + id + '/' + act, { method: 'POST' })
        .then(function (r) {
          btn.classList.toggle('on', !!r.on);
          btn.innerHTML = act === 'like' ? heartIcon(r.on) : saveIcon(r.on);
          if (act === 'like' && likesEl) {
            likesEl.textContent = '♥ ' + r.count + (likesEl.getAttribute('data-suffix') || '');
          }
          btn.title = r.on
            ? (act === 'like' ? 'Unlike' : 'Remove from wishlist')
            : (act === 'like' ? 'Like this design' : 'Save to wishlist');
          if (act === 'save') SM.toast(r.on ? 'Saved to your wishlist.' : 'Removed from your wishlist.');
          if (onChange) onChange(act, id, r);
        })
        .catch(function (err) {
          btn.classList.toggle('on', wasOn);
          btn.innerHTML = act === 'like' ? heartIcon(wasOn) : saveIcon(wasOn);
          SM.toast(err.message || 'Something went wrong.', 'error');
        })
        .then(function () { btn.disabled = false; });
    });
  }

  // ---------------------------------------------------------------- feed loading

  function feedUrl() {
    if (state.feed === 'mine')  return '/api/marketplace/mine/list';
    if (state.feed === 'saved') return '/api/marketplace/saved/list';
    if (state.feed === 'liked') return '/api/marketplace/liked/list';
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.designer) p.set('designer', state.designer);
    if (state.sort) p.set('sort', state.sort);
    p.set('page', state.page);
    p.set('limit', PAGE_SIZE);
    return '/api/marketplace?' + p.toString();
  }

  function emptyHTML() {
    var msg = {
      explore: ['No designs match that.', 'Try clearing the search or filters &mdash; or publish the first one yourself.'],
      mine:    ['You have not published anything yet.', 'Open the customizer, design a piece, then hit Publish to Community.'],
      saved:   ['Your wishlist is empty.', 'Tap the bookmark on any design to keep it here.'],
      liked:   ['No likes yet.', 'Tap the heart on designs you want to cheer on.']
    }[state.feed];
    return '<div class="col-12 sm-empty">' +
      '<span class="icon icon-shopping-bag"></span>' +
      '<h3 class="h5 text-black mb-2">' + msg[0] + '</h3>' +
      '<p>' + msg[1] + '</p>' +
      '<a href="/customize.html" class="btn btn-black rounded-0 mt-2">Start designing</a>' +
      '</div>';
  }

  function render(append) {
    var grid = $('sm-mk-grid');
    var countEl = $('sm-mk-count');
    var moreWrap = $('sm-mk-more-wrap');
    var drafts = state.feed === 'mine' ? state.drafts : [];

    if (!state.items.length && !drafts.length) {
      grid.innerHTML = emptyHTML();
      if (countEl) countEl.textContent = '';
      if (moreWrap) moreWrap.hidden = true;
      return;
    }

    // Drafts lead — they are the ones still waiting on a decision.
    var html = drafts.map(draftCardHTML).join('') + state.items.map(cardHTML).join('');
    if (append) grid.insertAdjacentHTML('beforeend', state.items.map(cardHTML).join(''));
    else grid.innerHTML = html;

    var total = state.feed === 'explore' ? state.total : state.items.length + drafts.length;
    if (countEl) {
      countEl.textContent = total + (total === 1 ? ' design' : ' designs') +
        (drafts.length ? ' · ' + drafts.length + ' draft' + (drafts.length === 1 ? '' : 's') : '');
    }
    if (moreWrap) moreWrap.hidden = !(state.feed === 'explore' && state.items.length < state.total);
  }

  // Typing in the search box fires overlapping requests; without this guard a
  // slow earlier response can land last and overwrite newer results.
  var reqSeq = 0;

  function load(append) {
    var grid = $('sm-mk-grid');
    if (!append) grid.innerHTML = '<div class="col-12 sm-loading">Loading designs&hellip;</div>';

    var mine = ++reqSeq;

    // The "My designs" tab shows published listings AND saved drafts, so it
    // needs both endpoints; every other feed is a single call.
    var request = state.feed === 'mine'
      ? Promise.all([SM.api(feedUrl()), SM.api('/api/designs')]).then(function (both) {
          var listings = both[0].items || [];
          var published = {};
          listings.forEach(function (l) { if (l.design_id) published[l.design_id] = true; });
          return {
            items: listings,
            drafts: (both[1] || []).filter(function (d) { return !published[d.id]; })
          };
        })
      : SM.api(feedUrl());

    request
      .then(function (r) {
        if (mine !== reqSeq) return;              // a newer request already won
        var items = r.items || [];
        state.items = append ? state.items.concat(items) : items;
        state.drafts = r.drafts || [];
        state.total = r.total != null ? r.total : items.length;
        render(append);
      })
      .catch(function (err) {
        if (mine !== reqSeq) return;
        var countEl = $('sm-mk-count');
        var moreWrap = $('sm-mk-more-wrap');
        if (err.status === 401) {
          var here = window.location.pathname + window.location.search;
          grid.innerHTML = '<div class="col-12 sm-empty">' +
            '<h3 class="h5 text-black mb-2">Sign in to see this</h3>' +
            '<p>Your designs, wishlist and likes live with your account.</p>' +
            '<a href="/login.html?next=' + encodeURIComponent(here) + '" class="btn btn-black rounded-0 mt-2">Sign in</a>' +
            '</div>';
          if (countEl) countEl.textContent = '';
          if (moreWrap) moreWrap.hidden = true;
          return;
        }
        grid.innerHTML = '<div class="col-12 sm-empty">' +
          '<h3 class="h5 text-black mb-2">Could not load your designs</h3>' +
          '<p>' + esc(err.message || 'Please try again.') + '</p>' +
          '</div>';
        if (moreWrap) moreWrap.hidden = true;
      });
  }

  function reload() {
    state.page = 1;
    load(false);
  }

  // ---------------------------------------------------------------- wiring

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // Bind only if the element is on this page. my-designs.html reuses this file
  // but has no tab strip or filter bar, so those simply aren't wired there.
  function on(id, type, handler) {
    var el = $(id);
    if (el) el.addEventListener(type, handler);
    return el;
  }

  function setFiltersVisible(visible) {
    var el = $('sm-mk-filters');
    if (el) el.style.display = visible ? '' : 'none';
  }

  function bind() {
    on('sm-mk-tabs', 'click', function (e) {
      var tab = e.target.closest('.sm-mk-tab');
      if (!tab) return;
      var tabs = this.querySelectorAll('.sm-mk-tab');
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
      tab.classList.add('active');
      state.feed = tab.getAttribute('data-feed');
      // Search/sort only apply to the public feed; the rest are simple lists.
      setFiltersVisible(state.feed === 'explore');
      reload();
    });

    on('sm-mk-search', 'input', debounce(function () {
      state.q = $('sm-mk-search').value.trim();
      reload();
    }, 300));

    on('sm-mk-category', 'change', function () {
      state.category = this.value;
      reload();
    });

    on('sm-mk-sort', 'change', function () {
      state.sort = this.value;
      reload();
    });

    on('sm-mk-more', 'click', function () {
      state.page++;
      load(true);
    });

    bindDraftActions($('sm-mk-grid'));
    on('sm-mk-publish-cancel', 'click', closeDraftPublish);
    on('sm-mk-publish-submit', 'click', submitDraftPublish);
    on('sm-mk-publish-modal', 'click', function (e) {
      if (e.target === this) closeDraftPublish();
    });
    document.addEventListener('keydown', function (e) {
      var modal = $('sm-mk-publish-modal');
      if (e.key === 'Escape' && modal && !modal.hidden) closeDraftPublish();
    });

    bindToggles($('sm-mk-grid'), function (act, id, r) {
      // On the Saved/Liked feeds, un-toggling means the card no longer belongs.
      if ((state.feed === 'saved' && act === 'save' && !r.on) ||
          (state.feed === 'liked' && act === 'like' && !r.on)) {
        state.items = state.items.filter(function (l) { return String(l.id) !== String(id); });
        render(false);
      }
    });
  }

  // Exported so marketplace-item.js renders identical cards and reuses the
  // same optimistic toggle behaviour. Published under both globals: app.js owns
  // window.ShopMax while pages.js uses window.SM, and they are NOT the same
  // object — attaching to only one leaves the other file with undefined.
  var api = {
    cardHTML: cardHTML,
    bindToggles: bindToggles,
    heartIcon: heartIcon,
    saveIcon: saveIcon
  };
  window.SM = window.SM || {};
  window.SM.marketplace = api;
  if (window.ShopMax) window.ShopMax.marketplace = api;

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('sm-mk-grid')) return;   // detail page loads this file too
    bind();

    // A page can pin the feed (my-designs.html sets 'mine'); otherwise the tab
    // strip drives it and ?tab= deep-links into one.
    var pinned = window.SM_MARKETPLACE_FEED;
    var tab = pinned || SM.qs('tab');
    if (tab && ['explore', 'mine', 'saved', 'liked'].indexOf(tab) !== -1) {
      state.feed = tab;
      var btn = document.querySelector('.sm-mk-tab[data-feed="' + tab + '"]');
      if (btn) {
        document.querySelectorAll('.sm-mk-tab').forEach(function (t) { t.classList.remove('active'); });
        btn.classList.add('active');
      }
      setFiltersVisible(tab === 'explore');
    }
    var q = SM.qs('q');
    var searchBox = $('sm-mk-search');
    if (q && searchBox) { state.q = q; searchBox.value = q; }

    // ?designer=<uuid> — "see their other designs" from a listing page.
    var designer = SM.qs('designer');
    var countEl = $('sm-mk-count');
    if (designer && countEl) {
      state.designer = designer;
      countEl.insertAdjacentHTML('beforebegin',
        '<a href="/marketplace.html" class="sm-mk-tag" id="sm-mk-clear-designer">Showing one designer &times;</a>');
    }

    load(false);
  });
})();
