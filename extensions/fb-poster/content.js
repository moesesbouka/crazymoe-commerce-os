(() => {
  if (window.__cmPosterLoaded) return;
  window.__cmPosterLoaded = true;

  let cfg = { supabaseUrl: '', supabaseKey: '', sourceMode: 'supabase', autoAdvance: true, advanceDelay: 1500 };
  const S = { items: [], idx: 0, files: [], fileMap: new Map(), completed: 0, failed: 0, sessionId: null, thumbUrls: [] };

  const root = document.createElement('div');
  root.id = 'fb-auto-uploader-root';
  root.innerHTML = `
    <button id="fb-auto-uploader-toggle">FB Poster</button>
    <div id="fb-auto-uploader-panel" class="hidden">
      <div class="fbau-brand"><div class="fbau-icon">FB</div><div><div class="fbau-title">CrazyMoe FB Poster</div><div class="fbau-sub">Execution layer for moe-inventory.</div></div></div>
      <div class="fbau-card"><div class="fbau-eyebrow">Pre-flight</div>
        <div class="fbau-grid">
          <div class="fbau-row"><span>Item source</span><span class="fbau-pill info" id="fbau-pill-manifest">Waiting</span></div>
          <div class="fbau-row"><span>Photos loaded</span><span class="fbau-pill info" id="fbau-pill-photos">Waiting</span></div>
          <div class="fbau-row"><span>Listing page</span><span class="fbau-pill info" id="fbau-pill-page">Detecting</span></div>
          <div class="fbau-row"><span>Connection</span><span class="fbau-pill warn" id="fbau-pill-conn">Not tested</span></div>
        </div>
      </div>
      <div class="fbau-card">
        <div class="fbau-eyebrow">Current batch</div>
        <div class="fbau-grid two">
          <div><label class="fbau-sub">Manifest JSON</label><input id="fbau-manifest" class="fbau-input" type="file" accept=".json" /></div>
          <div><label class="fbau-sub">Batch photos</label><input id="fbau-photos" class="fbau-input" type="file" accept="image/*" multiple /></div>
        </div>
        <div class="fbau-actions" style="margin-top:12px">
          <button id="fbau-test-supabase">Test Supabase Connection</button>
          <button id="fbau-load-supabase">Pull Ready Items</button>
          <button id="fbau-preview-matches">Preview matches</button>
          <button id="fbau-export">Export batch</button>
        </div>
        <div class="fbau-item-box" style="margin-top:12px">
          <div class="fbau-item-title" id="fbau-item-title">No items loaded</div>
          <div class="fbau-item-meta"><div>Item <span id="fbau-item-count">0 / 0</span></div><div id="fbau-item-meta">Load a manifest or pull ready items from Supabase.</div></div>
          <div class="fbau-thumbs" id="fbau-thumbs"></div>
        </div>
        <div class="fbau-actions" style="margin-top:12px"><button id="fbau-run" class="primary" style="width:100%">Run Listing</button></div>
        <div class="fbau-actions" style="margin-top:10px"><button id="fbau-fill" class="good">Fill only</button><button id="fbau-upload" class="good">Upload only</button></div>
        <div class="fbau-actions" style="margin-top:10px"><button id="fbau-prev">Previous</button><button id="fbau-next">Next</button><button id="fbau-skip" class="warn">Skip</button></div>
      </div>
      <div class="fbau-progress">
        <div class="fbau-metric"><div class="label">Current item</div><div class="value" id="fbau-metric-current">0 / 0</div><div class="sub">Track where you are in the batch.</div></div>
        <div class="fbau-metric"><div class="label">Matched images</div><div class="value" id="fbau-metric-images">0</div><div class="sub">Previewable files for this item.</div></div>
        <div class="fbau-metric"><div class="label">Completed</div><div class="value" id="fbau-metric-completed">0</div><div class="sub">Rows marked done in this session.</div></div>
        <div class="fbau-metric"><div class="label">Failed</div><div class="value" id="fbau-metric-failed">0</div><div class="sub">Structured error paths.</div></div>
      </div>
      <div class="fbau-card"><div class="fbau-eyebrow">Status</div><div id="fbau-status" class="info">Ready.</div></div>
    </div>`;

  document.documentElement.appendChild(root);
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const panel = $('#fb-auto-uploader-panel', root);
  const statusEl = $('#fbau-status', root);

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const base = s => String(s || '').split(/[\/\\]/).pop();
  const cur = () => S.items[S.idx] || null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function setStatus(msg, type = 'info') {
    statusEl.textContent = msg;
    statusEl.className = type;
  }
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function scoreCandidate(el, wanted) {
    let score = 0;
    const txt = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
      el.name || '',
      el.id || '',
      (el.closest('label, div, section') || {}).textContent || ''
    ].join(' ').toLowerCase();
    if (txt.includes(wanted)) score += 10;
    if (el.tagName === 'TEXTAREA') score += 2;
    if (isVisible(el)) score += 4;
    return score;
  }
  function findInput(wanted) {
    const all = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
    const scored = all.map(el => ({ el, score: scoreCandidate(el, wanted.toLowerCase()) }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }
  function findSelectLike(wanted) {
    const all = [...document.querySelectorAll('[role="combobox"], [role="listbox"], select')];
    const scored = all.map(el => ({ el, score: scoreCandidate(el, wanted.toLowerCase()) }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }
  async function waitFor(fn, label, timeout = 8000, interval = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const out = fn();
      if (out) return out;
      await sleep(interval);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }
  async function sbFetch(path, opts = {}) {
    if (!cfg.supabaseUrl || !cfg.supabaseKey) throw new Error('Supabase not configured');
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1${path}`, {
      headers: {
        apikey: cfg.supabaseKey,
        Authorization: `Bearer ${cfg.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      ...opts
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
  }
  async function ensureSession() {
    if (S.sessionId || cfg.sourceMode !== 'supabase') return S.sessionId;
    const session = await sbFetch('/posting_sessions', {
      method: 'POST',
      body: JSON.stringify({ item_count: S.items.length, status: 'active' })
    });
    S.sessionId = Array.isArray(session) ? session[0].id : session.id;
    return S.sessionId;
  }
  async function finalizeSession() {
    if (!S.sessionId || cfg.sourceMode !== 'supabase') return;
    await sbFetch(`/posting_sessions?id=eq.${S.sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        completed_at: new Date().toISOString(),
        posted_count: S.completed,
        failed_count: S.failed,
        status: 'completed'
      })
    });
  }
  function fireFullInputSequence(el, value) {
    el.focus();
    if (el.matches('input, textarea')) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    el.blur();
  }
  function buildItemFiles(item) {
    const explicit = (item?.images || []).map(base);
    if (explicit.length) return explicit.map(name => S.fileMap.get(norm(name))).filter(Boolean);
    const needle = norm(item?.sku || item?.model || item?.title);
    return S.files.filter(f => norm(f.name).includes(needle));
  }
  function clearThumbUrls() {
    S.thumbUrls.forEach(u => URL.revokeObjectURL(u));
    S.thumbUrls = [];
  }
  function renderThumbs(files) {
    clearThumbUrls();
    const wrap = $('#fbau-thumbs', root);
    wrap.innerHTML = '';
    files.slice(0, 8).forEach(file => {
      const url = URL.createObjectURL(file);
      S.thumbUrls.push(url);
      const div = document.createElement('div');
      div.className = 'fbau-thumb';
      div.innerHTML = `<img src="${url}" alt="${file.name}">`;
      wrap.appendChild(div);
    });
  }
  async function uploadImages(files) {
    if (!files.length) return 0;
    const fileInput = [...document.querySelectorAll('input[type="file"]')]
      .filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (!fileInput) throw new Error('No visible file input found');
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    return files.length;
  }
  async function fillCurrentItem() {
    const item = cur();
    if (!item) throw new Error('No current item');
    const title = await waitFor(() => findInput('title'), 'title field');
    const price = findInput('price');
    const desc = findInput('description');
    const condition = findSelectLike('condition') || findInput('condition');

    fireFullInputSequence(title, item.title || '');
    if (price) fireFullInputSequence(price, String(item.price || ''));
    if (desc) fireFullInputSequence(desc, item.description || '');
    if (condition && item.condition) {
      try { fireFullInputSequence(condition, item.condition); } catch (_) {}
    }
  }
  async function loadFromSupabase() {
    const items = await sbFetch('/inventory_items?status=eq.ready&order=created_at.asc&limit=50');
    S.items = items.map(it => ({
      id: it.id,
      title: it.optimized_title || it.title || '',
      description: it.optimized_description || it.description || '',
      price: it.optimized_price || it.price || '',
      condition: it.condition || 'Good',
      sku: it.sku || '',
      model: it.model || '',
      images: it.image_manifest || [],
      _sb: true
    }));
    S.idx = 0;
    S.sessionId = null;
  }
  async function writeResult(item, imagesUploaded = 0, result = 'success', errorMessage = null, durationMs = 0) {
    if (!(item && item._sb && item.id) || cfg.sourceMode !== 'supabase') return;
    await ensureSession();
    if (result === 'success') {
      await sbFetch(`/inventory_items?id=eq.${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'posted', listed_at: new Date().toISOString() })
      });
    }
    await sbFetch('/posting_results', {
      method: 'POST',
      body: JSON.stringify({
        session_id: S.sessionId,
        inventory_item_id: item.id,
        result,
        error_message: errorMessage,
        images_uploaded: imagesUploaded,
        duration_ms: durationMs,
        posted_at: new Date().toISOString()
      })
    });
  }
  function updateSummary() {
    const item = cur();
    const files = item ? buildItemFiles(item) : [];
    $('#fbau-item-count', root).textContent = `${S.items.length ? S.idx + 1 : 0} / ${S.items.length}`;
    $('#fbau-item-title', root).textContent = item ? item.title || '(untitled)' : 'No items loaded';
    $('#fbau-item-meta', root).textContent = item ? `Price: ${item.price || ''} | Condition: ${item.condition || ''} | Images: ${(item.images || []).length}` : 'Load a manifest or pull ready items from Supabase.';
    $('#fbau-metric-current', root).textContent = `${S.items.length ? S.idx + 1 : 0} / ${S.items.length}`;
    $('#fbau-metric-images', root).textContent = item ? String(files.length) : '0';
    $('#fbau-metric-completed', root).textContent = String(S.completed);
    $('#fbau-metric-failed', root).textContent = String(S.failed);
    renderThumbs(files);

    const sourcePill = $('#fbau-pill-manifest', root);
    sourcePill.textContent = S.items.length ? `${cfg.sourceMode}` : 'Waiting';
    sourcePill.className = `fbau-pill ${S.items.length ? 'ok' : 'info'}`;
    const photosPill = $('#fbau-pill-photos', root);
    photosPill.textContent = S.files.length ? `${S.files.length} loaded` : 'Waiting';
    photosPill.className = `fbau-pill ${S.files.length ? 'ok' : 'info'}`;
    const pagePill = $('#fbau-pill-page', root);
    const onMarketplace = /facebook\.com\/marketplace/.test(location.href);
    pagePill.textContent = onMarketplace ? 'Detected' : 'Wrong page';
    pagePill.className = `fbau-pill ${onMarketplace ? 'ok' : 'bad'}`;
  }
  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { try { resolve(JSON.parse(reader.result)); } catch (e) { reject(e); } };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  function exportBatch() {
    const blob = new Blob([JSON.stringify({
      items: S.items,
      idx: S.idx,
      completed: S.completed,
      failed: S.failed,
      sourceMode: cfg.sourceMode,
      sessionId: S.sessionId
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crazymoe-fb-poster-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function testConnection() {
    try {
      await sbFetch('/inventory_items?select=id&limit=1');
      $('#fbau-pill-conn', root).textContent = 'Connected';
      $('#fbau-pill-conn', root).className = 'fbau-pill ok';
      setStatus('Supabase connection OK.', 'ok');
    } catch (e) {
      $('#fbau-pill-conn', root).textContent = 'Failed';
      $('#fbau-pill-conn', root).className = 'fbau-pill bad';
      setStatus(`Supabase connection failed: ${e.message}`, 'bad');
    }
  }
  async function runListing() {
    const item = cur();
    if (!item) return setStatus('No current item', 'warn');
    const started = Date.now();
    try {
      if (cfg.sourceMode === 'supabase') await ensureSession();
      setStatus('Running listing...', 'info');
      await fillCurrentItem();
      const uploaded = await uploadImages(buildItemFiles(item));
      const duration = Date.now() - started;
      S.completed += 1;
      if (item && item._sb) await writeResult(item, uploaded, 'success', null, duration);
      updateSummary();
      setStatus(`Listing run complete — ${uploaded} image(s) attached in ${duration} ms.`, 'ok');
      const atLast = S.idx >= S.items.length - 1;
      if (atLast) await finalizeSession();
      if (cfg.autoAdvance && !atLast) {
        await sleep(cfg.advanceDelay || 1500);
        S.idx += 1;
        updateSummary();
      }
    } catch (e) {
      const duration = Date.now() - started;
      S.failed += 1;
      updateSummary();
      if (item && item._sb) { try { await writeResult(item, 0, 'failed', e.message, duration); } catch (_) {} }
      setStatus(`Run failed: ${e.message}`, 'bad');
    }
  }

  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, loadedCfg => {
    cfg = Object.assign({}, cfg, loadedCfg || {});
    updateSummary();
  });

  $('#fb-auto-uploader-toggle', root).addEventListener('click', () => panel.classList.toggle('hidden'));
  $('#fbau-manifest', root).addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const raw = await readJsonFile(file);
      const items = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
      if (!items.length) throw new Error('Empty manifest');
      S.items = items.map((it, idx) => ({
        id: it.id || idx + 1,
        title: it.title || '',
        price: it.price || '',
        description: it.description || '',
        condition: it.condition || '',
        sku: it.sku || '',
        model: it.model || '',
        images: Array.isArray(it.images) ? it.images : []
      }));
      S.idx = 0;
      S.sessionId = null;
      cfg.sourceMode = 'local';
      updateSummary();
      setStatus(`Loaded ${S.items.length} item(s) from manifest.`, 'ok');
    } catch (_) {
      setStatus('Invalid manifest JSON.', 'bad');
    }
  });
  $('#fbau-photos', root).addEventListener('change', e => {
    clearThumbUrls();
    S.files = [...(e.target.files || [])];
    S.fileMap = new Map(S.files.map(f => [norm(f.name), f]));
    updateSummary();
    setStatus(`Loaded ${S.files.length} image file(s).`, 'ok');
  });
  $('#fbau-test-supabase', root).addEventListener('click', testConnection);
  $('#fbau-load-supabase', root).addEventListener('click', async () => {
    try {
      cfg.sourceMode = 'supabase';
      await loadFromSupabase();
      updateSummary();
      setStatus(`Loaded ${S.items.length} ready item(s) from Supabase.`, 'ok');
    } catch (e) {
      setStatus(`Supabase load failed: ${e.message}`, 'bad');
    }
  });
  $('#fbau-run', root).addEventListener('click', runListing);
  $('#fbau-fill', root).addEventListener('click', async () => { try { await fillCurrentItem(); setStatus('Fields filled.', 'ok'); } catch (e) { setStatus(`Fill failed: ${e.message}`, 'bad'); } });
  $('#fbau-upload', root).addEventListener('click', async () => { try { const n = await uploadImages(buildItemFiles(cur())); setStatus(`Uploaded ${n} image(s).`, 'ok'); } catch (e) { setStatus(`Upload failed: ${e.message}`, 'bad'); } });
  $('#fbau-prev', root).addEventListener('click', () => { if (!S.items.length) return; S.idx = Math.max(0, S.idx - 1); updateSummary(); });
  $('#fbau-next', root).addEventListener('click', () => { if (!S.items.length) return; S.idx = Math.min(S.items.length - 1, S.idx + 1); updateSummary(); });
  $('#fbau-skip', root).addEventListener('click', async () => {
    if (!S.items.length) return;
    const item = cur();
    S.failed += 1;
    if (item && item._sb) { try { await ensureSession(); await writeResult(item, 0, 'skipped', 'Skipped by user', 0); } catch (_) {} }
    const atLast = S.idx >= S.items.length - 1;
    if (atLast) await finalizeSession();
    S.idx = Math.min(S.items.length - 1, S.idx + 1);
    updateSummary();
    setStatus('Skipped current item.', 'warn');
  });
  $('#fbau-preview-matches', root).addEventListener('click', () => {
    const item = cur();
    if (!item) return setStatus('No item loaded.', 'warn');
    const files = buildItemFiles(item);
    setStatus(`Preview — ${files.length} image(s):\n${files.map(f => f.name).join('\n') || 'None'}`, 'info');
  });
  $('#fbau-export', root).addEventListener('click', () => { exportBatch(); setStatus('Batch exported.', 'ok'); });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); runListing(); }
    if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); panel.classList.toggle('hidden'); }
  });

  window.addEventListener('beforeunload', clearThumbUrls);
})();async function setCondition(conditionText) {
  const dropdown = document.querySelector(`[aria-label="Condition"]`) || document.querySelector(`[aria-label="Select Condition"]`);
  if (!dropdown) return console.error("Dropdown not found");
  dropdown.click();
  setTimeout(() => {
    const options = Array.from(document.querySelectorAll(`[role="option"], [role="menuitem"]`));
    const target = options.find(el => el.textContent.toLowerCase().includes(conditionText.toLowerCase()));
    if (target) target.click();
  }, 500);
}
