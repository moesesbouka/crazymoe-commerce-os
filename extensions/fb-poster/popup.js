const urlEl = document.getElementById('url');
const keyEl = document.getElementById('key');
const msgEl = document.getElementById('msg');

chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, cfg => {
  if (!cfg) return;
  urlEl.value = cfg.supabase_url || '';
  keyEl.value = cfg.supabase_key || '';
});

document.getElementById('save').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    supabase_url: urlEl.value.trim(),
    supabase_key: keyEl.value.trim()
  }, () => {
    msgEl.textContent = 'Saved';
  });
});

document.getElementById('test').addEventListener('click', async () => {
  const url = urlEl.value.trim();
  const key = keyEl.value.trim();

  try {
    const res = await fetch(url + '/rest/v1/inventory_items?select=id&limit=1', {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key
      }
    });

    if (res.ok) {
      msgEl.textContent = 'Connection OK';
    } else {
      msgEl.textContent = 'Connection failed: ' + res.status;
    }
  } catch (e) {
    msgEl.textContent = 'Connection failed';
  }
});
