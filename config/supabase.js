// Supabase client + a "mode" flag the rest of the app reads.
//
// If you have not filled in .env yet, we gracefully run in "local" mode using
// an in-memory + file JSON store (see src/db/localStore.js). The whole site
// still works for demos. Once you add real Supabase keys, it flips to "supabase"
// mode and uses your cloud database automatically.

require('dotenv').config();

const URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_ANON_KEY || '';

const MODE = (URL && KEY && URL.startsWith('http')) ? 'supabase' : 'local';

let supabase = null;
if (MODE === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(URL, KEY);
}

function isConfigured() {
  return MODE === 'supabase';
}

module.exports = { supabase, MODE, isConfigured };
