chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], cfg => {
    if (!(cfg && cfg.supabaseUrl)) {
      chrome.storage.local.set({
        supabaseUrl: '',
        supabaseKey: '',
        sourceMode: 'supabase',
        autoAdvance: true,
        advanceDelay: 1500,
      });
    }
  });
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_CONFIG') { chrome.storage.local.get(null, sendResponse); return true; }
  if (msg.type === 'SET_CONFIG') { chrome.storage.local.set(msg.data, () => sendResponse({ ok: true })); return true; }
});