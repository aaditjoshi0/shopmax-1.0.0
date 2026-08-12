// Thumbnail self-healing.
//
// Designs store a thumbnail_url in the database, but the actual image bytes
// live in the app's local /images directory (see POST /api/designs/preview in
// src/api/designs.js). The database may be shared across machines (Supabase)
// while the filesystem is not — a design whose preview was uploaded from
// another machine points at a local file that does not exist here, and every
// <img> using that URL renders a broken-image icon.
//
// When a row's stored image URL refers to a local /images file that is missing,
// we rebuild that exact file from the artwork embedded in the saved snapshot
// (designs.canvas_data / listings.design_snapshot both carry it). The stored
// URL keeps working and the thumbnail is a real image again. Valid thumbnail
// files are never touched.

const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', '..', 'images');
const IMAGE_URL_RE = /^\/images\/([A-Za-z0-9_.-]+)$/;
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

// First design-artwork data URL found in a saved snapshot (canvas_data or
// design_snapshot). Prefers the Front, then Back, then Sleeve, then any slot.
function artworkDataUrl(snapshot) {
  let snap = snapshot;
  if (typeof snap === 'string') {
    try { snap = JSON.parse(snap); } catch (e) { return null; }
  }
  if (!snap || typeof snap !== 'object' || !snap.positions) return null;
  const preferred = ['Front', 'Back', 'Sleeve'];
  for (let i = 0; i < preferred.length; i++) {
    const slot = snap.positions[preferred[i]];
    if (slot && slot.design && typeof slot.design.dataUrl === 'string' &&
        DATA_URL_RE.test(slot.design.dataUrl)) return slot.design.dataUrl;
  }
  const keys = Object.keys(snap.positions);
  for (let i = 0; i < keys.length; i++) {
    const slot = snap.positions[keys[i]];
    if (slot && slot.design && typeof slot.design.dataUrl === 'string' &&
        DATA_URL_RE.test(slot.design.dataUrl)) return slot.design.dataUrl;
  }
  return null;
}

// If imageUrl points at a local /images file that is missing on disk, recreate
// it from the artwork inside the saved snapshot so the stored URL resolves
// again. Returns true when the URL is servable (file existed or was restored).
function restoreThumbnailFile(imageUrl, snapshot) {
  if (typeof imageUrl !== 'string') return false;
  const m = IMAGE_URL_RE.exec(imageUrl);
  if (!m) return true;          // external/data URL — not a local file, nothing to restore
  const file = path.join(IMAGES_DIR, m[1]);
  if (fs.existsSync(file)) return true;   // valid thumbnail — never overwrite it
  const dataUrl = artworkDataUrl(snapshot);
  if (!dataUrl) return false;   // nothing to rebuild from — caller falls back to initials
  const dm = DATA_URL_RE.exec(dataUrl);
  if (!dm) return false;
  try {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.from(dm[2], 'base64'));
    return true;
  } catch (e) {
    console.warn('[thumbnails] could not restore ' + imageUrl + ':', e.message);
    return false;
  }
}

module.exports = { restoreThumbnailFile };
