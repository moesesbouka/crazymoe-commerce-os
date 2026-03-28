chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['supabase_url','supabase_key'], cfg => {
    if (!cfg.supabase_url) {
      chrome.storage.local.set({
        supabase_url: '',
        supabase_key: ''
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_CONFIG') {
    chrome.storage.local.get(['supabase_url','supabase_key'], sendResponse);
    return true;
  }

  if (request.type === 'SET_CONFIG') {
    chrome.storage.local.set({
      supabase_url: request.supabase_url || '',
      supabase_key: request.supabase_key || ''
    }, () => sendResponse({ ok: true }));
    return true;
  }

  if (request.type === 'FETCH_READY') {
    chrome.storage.local.get(['supabase_url','supabase_key'], async (cfg) => {
      try {
        if (!cfg.supabase_url || !cfg.supabase_key) {
          sendResponse({ ok: false, error: 'Missing config' });
          return;
        }

        const res = await fetch(cfg.supabase_url + '/rest/v1/inventory_items?status=eq.ready&select=*&limit=1', {
          headers: {
            apikey: cfg.supabase_key,
            Authorization: 'Bearer ' + cfg.supabase_key
          }
        });

        const data = await res.json();
        if (Array.isArray(data) -and data.length -gt 0) {
          sendResponse({ ok: true, item: data[0] });
        } else {
          sendResponse({ ok: true, item: null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  }
});
