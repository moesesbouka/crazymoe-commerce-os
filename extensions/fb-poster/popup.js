const $ = id => document.getElementById(id);

function showToast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function updatePill(url, key) {
  const pill = $('sb-pill');
  const ok = !!(url && key);
  pill.textContent = ok ? 'Configured' : 'Not configured';
  pill.className = `pill ${ok ? 'ok' : 'warn'}`;
}

async function testSupabase(url, key) {
  const r = await fetch(`${url}/rest/v1/inventory_items?select=id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
}

chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, cfg => {
  if (!cfg) return;
  $('sb-url').value = cfg.supabaseUrl || '';
  $('sb-key').value = cfg.supabaseKey || '';
  $('source-mode').value = cfg.sourceMode || 'supabase';
  updatePill(cfg.supabaseUrl, cfg.supabaseKey);
});

$('save').addEventListener('click', () => {
  const url = $('sb-url').value.trim();
  const key = $('sb-key').value.trim();
  const mode = $('source-mode').value;
  if (!url || !key) return showToast('Both URL and key are required', 'bad');
  if (!url.startsWith('https://')) return showToast('URL must start with https://', 'bad');
  chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    data: { supabaseUrl: url, supabaseKey: key, sourceMode: mode, autoAdvance: true, advanceDelay: 1500 }
  }, () => {
    updatePill(url, key);
    showToast('Config saved ✓', 'ok');
  });
});

$('test').addEventListener('click', async () => {
  const url = $('sb-url').value.trim();
  const key = $('sb-key').value.trim();
  if (!url || !key) return showToast('Enter URL + key first', 'bad');
  try {
    await testSupabase(url, key);
    updatePill(url, key);
    showToast('Connection OK', 'ok');
  } catch (e) {
    showToast(`Connection failed: ${e.message}`, 'bad');
  }
});

$('open').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/create/item' }));