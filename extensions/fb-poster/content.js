(function() {
    function inject() {
        // Only act if we are on the Marketplace Create page
        if (!window.location.href.includes('marketplace/create')) return;
        if (document.getElementById('cm-panel')) return;
        
        console.log('CrazyMoe: Forcing Panel Injection...');
        
        const panel = document.createElement('div');
        panel.id = 'cm-panel';
        panel.style = 'position:fixed;top:20px;right:20px;width:240px;background:#1a1d26;color:white;padding:15px;border-radius:12px;z-index:999999999;border:3px solid #3b82f6;box-shadow:0 10px 40px rgba(0,0,0,0.8);font-family:sans-serif;font-size:14px;';
        
        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:10px;color:#3b82f6;">CrazyMoe FB OS</div>
            <div id="cm-status" style="font-size:11px;margin-bottom:10px;color:#aaa;">Ready</div>
            <button id="pull-btn" style="width:100%;padding:8px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;margin-bottom:5px;">1. Pull Item</button>
            <button id="fill-btn" style="width:100%;padding:8px;background:#333;color:white;border:1px solid #444;border-radius:6px;cursor:pointer;">2. Fill Form</button>
        `;
        
        document.body.appendChild(panel);

        document.getElementById('pull-btn').onclick = () => {
            document.getElementById('cm-status').innerText = 'Syncing...';
            chrome.runtime.sendMessage({type: "FETCH_READY"}, (res) => {
                if(res && res.item) {
                    window.lastItem = res.item;
                    document.getElementById('cm-status').innerText = 'Loaded: ' + res.item.title;
                    document.getElementById('cm-status').style.color = '#56d364';
                }
            });
        };
    }

    // Run immediately and then poll every 2 seconds to beat Facebook's internal routing
    inject();
    setInterval(inject, 2000);
})();
