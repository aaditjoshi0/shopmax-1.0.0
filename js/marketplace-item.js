/* ShopMax — Community Marketplace, single design.
 *
 * Buying a community design puts a custom line item in the cart (no product_id,
 * so it never touches shop stock) carrying meta.listing_id / meta.design_id so
 * the order shows where it came from and who designed it.
 */

(function () {
  'use strict';

  var SM = window.ShopMax;
  var listing = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return SM.escapeHtml(String(s == null ? '' : s)); }

  var CATEGORY_LABELS = {
    tshirt: 'T-shirt', hoodie: 'Hoodie', shirt: 'Shirt', jacket: 'Jacket',
    bottoms: 'Bottoms', accessory: 'Accessory', other: 'Other'
  };

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  function detailHTML(l) {
    var tags = (l.tags || []).map(function (t) {
      return '<a href="/marketplace.html?q=' + encodeURIComponent(t) + '" class="sm-mk-tag">#' + esc(t) + '</a>';
    }).join('');

    var ownerBar = l.is_mine
      ? '<div class="alert alert-light border mt-3 mb-0">' +
          'This is your design. ' +
          '<button class="btn btn-sm btn-link p-0 align-baseline" id="sm-mk-toggle-status">' +
            (l.status === 'active' ? 'Hide it from the marketplace' : 'Publish it again') +
          '</button> &middot; ' +
          '<button class="btn btn-sm btn-link p-0 align-baseline text-danger" id="sm-mk-delete">Delete</button>' +
        '</div>'
      : '';

    return '' +
      '<div class="row">' +
        '<div class="col-md-6 mb-4">' +
          '<div class="sm-mk-detail-img" style="position:relative">' +
            '<div class="sm-mk-actions">' +
              '<button class="sm-mk-icon sm-mk-like' + (l.liked ? ' on' : '') + '" data-act="like" data-id="' + l.id + '" aria-label="Like">' +
                SM.marketplace.heartIcon(l.liked) +
              '</button>' +
              '<button class="sm-mk-icon sm-mk-save' + (l.saved ? ' on' : '') + '" data-act="save" data-id="' + l.id + '" aria-label="Save">' +
                SM.marketplace.saveIcon(l.saved) +
              '</button>' +
            '</div>' +
            '<img src="' + esc(l.image_url) + '" alt="' + esc(l.title) + '">' +
          '</div>' +
        '</div>' +

        '<div class="col-md-6">' +
          '<h1 class="text-black h3 mb-1">' + esc(l.title) + '</h1>' +
          '<div class="sm-mk-meta mb-2">' +
            '<span data-role="likes" data-suffix=" likes">♥ ' + (l.likes_count || 0) + ' likes</span>' +
            '<span>◉ ' + (l.views || 0) + ' views</span>' +
            '<span>' + esc(CATEGORY_LABELS[l.category] || l.category) + '</span>' +
          '</div>' +
          '<div class="sm-mk-price">' + SM.money(l.price) + '</div>' +

          '<div class="sm-mk-byline">' +
            '<div class="sm-mk-avatar">' + esc(initials(l.designer_name)) + '</div>' +
            '<div>' +
              '<div style="font-weight:600">' + esc(l.designer_name) + '</div>' +
              '<a href="/marketplace.html?designer=' + encodeURIComponent(l.user_id) + '" style="font-size:13px;color:#888">' +
                'See their other designs' +
              '</a>' +
            '</div>' +
          '</div>' +

          (l.description ? '<p style="white-space:pre-wrap">' + esc(l.description) + '</p>' : '') +
          (tags ? '<div class="mb-3">' + tags + '</div>' : '') +

          (l.size ? '<p class="mb-1"><strong>Size:</strong> ' + esc(l.size) + '</p>' : '') +
          (l.color ? '<p class="mb-1"><strong>Colour:</strong> ' + esc(l.color) + '</p>' : '') +

          '<div class="sm-mk-cta">' +
            '<button class="btn btn-black rounded-0" id="sm-mk-buy">Add to bag</button>' +
            (l.design_id
              ? '<a class="btn btn-outline-black rounded-0" href="/customize.html?remix=' + l.id + '">Customize this</a>'
              : '') +
          '</div>' +
          '<p style="font-size:13px;color:#888">Made to order from this design. Nothing is shipped from stock.</p>' +
          ownerBar +
        '</div>' +
      '</div>';
  }

  function bindDetail(l) {
    var buy = $('sm-mk-buy');
    if (buy) {
      buy.addEventListener('click', function () {
        buy.disabled = true;
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
          .then(function () { buy.disabled = false; });
      });
    }

    var toggle = $('sm-mk-toggle-status');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = l.status === 'active' ? 'hidden' : 'active';
        SM.api('/api/marketplace/' + l.id, {
          method: 'PATCH',
          body: JSON.stringify({ status: next })
        }).then(function () {
          SM.toast(next === 'hidden' ? 'Hidden from the marketplace.' : 'Published again.');
          window.location.reload();
        }).catch(function (err) { SM.toast(err.message || 'Could not update.', 'error'); });
      });
    }

    var del = $('sm-mk-delete');
    if (del) {
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this listing? This cannot be undone.')) return;
        SM.api('/api/marketplace/' + l.id, { method: 'DELETE' })
          .then(function () {
            SM.toast('Listing deleted.');
            window.location.href = '/marketplace.html?tab=mine';
          })
          .catch(function (err) { SM.toast(err.message || 'Could not delete.', 'error'); });
      });
    }
  }

  function loadRelated(id) {
    SM.api('/api/marketplace/' + id + '/related')
      .then(function (r) {
        var items = r.items || [];
        if (!items.length) return;
        $('sm-mk-related').innerHTML = items.map(SM.marketplace.cardHTML).join('');
        $('sm-mk-related-wrap').hidden = false;
        SM.marketplace.bindToggles($('sm-mk-related'));
      })
      .catch(function () { /* related is a nicety — never block the page */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = $('sm-mk-detail');
    if (!host) return;

    var id = SM.qs('id');
    if (!id) {
      host.innerHTML = '<div class="sm-empty"><h3 class="h5 text-black">No design selected</h3>' +
        '<a href="/marketplace.html" class="btn btn-black rounded-0 mt-2">Browse the marketplace</a></div>';
      return;
    }

    SM.api('/api/marketplace/' + id)
      .then(function (l) {
        listing = l;
        document.title = l.title + ' — ShopMax';
        $('sm-mk-crumb').textContent = l.title;
        host.innerHTML = detailHTML(l);
        bindDetail(l);
        SM.marketplace.bindToggles(host);
        loadRelated(l.id);
      })
      .catch(function (err) {
        host.innerHTML = '<div class="sm-empty">' +
          '<h3 class="h5 text-black mb-2">' + (err.status === 404 ? 'Design not found' : 'Could not load this design') + '</h3>' +
          '<p>' + esc(err.message || '') + '</p>' +
          '<a href="/marketplace.html" class="btn btn-black rounded-0 mt-2">Browse the marketplace</a>' +
          '</div>';
      });
  });
})();
