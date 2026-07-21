// Supabase client + a "mode" flag the rest of the app reads.
//
// If you have not filled in .env yet, we gracefully run in "local" mode using
// an in-memory + file JSON store (see src/db/localStore.js). The whole site
// still works for demos. Once you add real Supabase keys, it flips to "supabase"
// mode and uses your cloud database automatically.

require('dotenv').config();

const URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const MODE = (URL && KEY && URL.startsWith('http')) ? 'supabase' : 'local';

let supabase = null;
let serviceClient = null;
if (MODE === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(URL, KEY);
  if (SERVICE_KEY) {
    serviceClient = createClient(URL, SERVICE_KEY);
  }
}

function getAuthedClient(jwt) {
  if (MODE !== 'supabase' || !jwt) return supabase;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(URL, KEY, {
    global: { headers: { Authorization: 'Bearer ' + jwt } }
  });
}

function getServiceClient() {
  return serviceClient;
}

function isConfigured() {
  return MODE === 'supabase';
}

module.exports = { supabase, MODE, getAuthedClient, getServiceClient, isConfigured };
