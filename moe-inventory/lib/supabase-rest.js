window.cmSupabaseFetch = async function(path, opts = {}) {
  const { supabaseUrl, supabaseKey } = window.CM_CONFIG || {};
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase config missing');
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
};