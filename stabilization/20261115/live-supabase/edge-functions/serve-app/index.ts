const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="theme-color" content="#c9a84c"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="CrunchForge"/>
<title>CrunchForge</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#080808;color:#f5f0e8;min-height:100vh;line-height:1.7}
:root{--gold:#c9a84c;--gold2:#e8c96d;--gold-dim:#7a6530;--s1:#111;--s2:#1a1a1a;--s3:#222;--border:rgba(201,168,76,.15);--border2:rgba(201,168,76,.3);--text:#f5f0e8;--muted:#8a8070;--dim:#4a4540}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--gold-dim);border-radius:4px}
.app{max-width:1200px;margin:0 auto;padding:28px 24px;display:flex;flex-direction:column;gap:18px;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.brand{display:flex;align-items:center;gap:12px}
.brand-icon{width:38px;height:38px;background:var(--gold);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.brand-name{font-size:19px;font-weight:700;letter-spacing:-.02em}
.brand-sub{font-size:12px;color:var(--muted);margin-top:1px}
.topbar-right{display:flex;gap:8px}
.tbtn{padding:7px 14px;border-radius:9px;border:1px solid var(--border2);background:transparent;font-size:13px;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .2s}
.tbtn:hover{background:var(--s2);color:var(--gold)}
.tbtn-gold{border-color:var(--gold);color:var(--gold)}
.tbtn-gold:hover{background:rgba(201,168,76,.08)}
.divider{height:1px;background:var(--gold-dim);opacity:.3}
.ctx-wrap{background:var(--s1);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.ctx-top{padding:11px 18px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
.ctx-label{font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.1em}
.ctx-toggle{font-size:11px;color:var(--dim)}
.ctx-body{overflow:hidden;max-height:0;transition:max-height .3s}
.ctx-body.open{max-height:260px}
.ctx-input{width:100%;background:transparent;border:none;outline:none;resize:none;font-size:14px;color:var(--text);line-height:1.65;font-family:inherit;padding:10px 18px 8px}
.ctx-input::placeholder{color:var(--dim);font-size:13px}
.ctx-hint{padding:0 18px 10px;font-size:11px;color:var(--dim)}
.prompt-zone{background:var(--s1);border:1px solid var(--border2);border-radius:18px;overflow:hidden}
.pz-top{padding:18px 24px 0;display:flex;align-items:center;justify-content:space-between}
.pz-label{font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.1em}
.pz-hint{font-size:11px;color:var(--dim);font-family:monospace;padding:3px 7px;border:1px solid var(--border);border-radius:5px}
.pta{width:100%;min-height:120px;background:transparent;border:none;outline:none;resize:none;font-size:18px;color:var(--text);line-height:1.7;font-family:inherit;padding:12px 24px}
.pta::placeholder{color:var(--dim);font-size:16px}
.pz-row{padding:12px 20px;border-top:1px solid var(--border);display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:#0d0d0d}
.mtog{display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:18px;border:1px solid var(--border);background:transparent;font-size:12px;font-weight:500;color:var(--muted);cursor:pointer;transition:all .2s;font-family:inherit}
.mt-on{border-color:var(--gold);background:rgba(201,168,76,.08);color:var(--gold2)}
.mdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.fire-btn{padding:11px 28px;border-radius:11px;background:var(--gold);color:#080808;border:none;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s}
.fire-btn:hover:not(:disabled){background:var(--gold2);transform:scale(1.02)}
.fire-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.crunch-btn{padding:10px 20px;border-radius:11px;background:transparent;border:1px solid var(--gold);color:var(--gold);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
.crunch-btn:hover:not(:disabled){background:rgba(201,168,76,.08)}
.crunch-btn:disabled{opacity:.35;cursor:not-allowed}
.reset-btn{padding:10px 14px;border-radius:9px;background:transparent;border:1px solid var(--border);color:var(--muted);font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
.reset-btn:hover{background:var(--s2);color:var(--text)}
.cn-wrap{background:var(--s1);border:1px solid var(--border2);border-radius:12px;overflow:hidden;display:none}
.cn-wrap.show{display:block}
.cn-top{padding:10px 16px 0;display:flex;align-items:center;justify-content:space-between}
.cn-label{font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.1em}
.cn-hint{font-size:11px;color:var(--dim)}
.cn-input{width:100%;background:transparent;border:none;outline:none;resize:none;font-size:14px;color:var(--text);line-height:1.6;font-family:inherit;padding:8px 16px 12px}
.cn-input::placeholder{color:var(--dim)}
.sbar{display:flex;align-items:center;gap:10px;padding:10px 18px;background:var(--s1);border:1px solid var(--border);border-radius:11px;flex-wrap:wrap}
.rl{font-size:13px;font-weight:600}
.rdots{display:flex;gap:5px}
.rdot{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:1px solid var(--border);color:var(--dim);background:var(--s2);transition:all .3s}
.rdot.active{background:var(--gold);border-color:var(--gold);color:#080808}
.rdot.done{background:rgba(201,168,76,.12);border-color:var(--gold-dim);color:var(--gold)}
.rst{margin-left:auto;font-size:12px;color:var(--muted)}
.rst.live{color:var(--gold)}
.hdots{display:flex;gap:8px;padding-left:12px;border-left:1px solid var(--border)}
.hdi{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted)}
.hd{width:6px;height:6px;border-radius:50%;background:var(--dim);transition:background .4s}
.hd.ok{background:#22c55e}.hd.err{background:#ef4444}.hd.pulse{background:var(--gold);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.mgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.mcard{background:var(--s1);border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;height:520px;transition:border-color .3s}
.mcard.winner{border-color:var(--gold)}
.mcard.off{opacity:.25;pointer-events:none}
.mhead{padding:13px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:#0d0d0d;flex-shrink:0}
.mname-wrap{display:flex;align-items:center;gap:8px}
.mcdot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.mname{font-size:15px;font-weight:700}
.mtone{font-size:10px;color:var(--muted);margin-top:1px}
.mlat{font-size:10px;color:var(--gold-dim);margin:0 6px}
.spill{padding:3px 10px;border-radius:9999px;font-size:10px;font-weight:600}
.sp-idle{background:var(--s2);color:var(--dim)}
.sp-thinking{background:rgba(201,168,76,.1);color:var(--gold);animation:pulse 1.2s infinite}
.sp-done{background:rgba(34,197,94,.08);color:#4ade80}
.sp-error{background:rgba(239,68,68,.08);color:#fca5a5}
.chat-thread{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.chat-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-style:italic;font-size:14px;text-align:center;padding:20px}
.msg{display:flex;flex-direction:column;gap:3px}
.msg.user{align-items:flex-end}
.msg.assistant{align-items:flex-start}
.msg-bubble{padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;max-width:92%}
.msg.user .msg-bubble{background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.25);color:#f5e4a0;border-radius:14px 14px 4px 14px}
.msg.assistant .msg-bubble{background:var(--s2);border:1px solid var(--border);color:#c8c0b0;border-radius:14px 14px 14px 4px}
.msg-time{font-size:10px;color:var(--dim);padding:0 4px}
.sh-line{background:linear-gradient(90deg,var(--s2) 25%,var(--s3) 50%,var(--s2) 75%);background-size:200% 100%;animation:sh 1.4s infinite;border-radius:8px;height:13px;margin:3px 0}
@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
.reply-zone{padding:10px 14px;border-top:1px solid var(--border);background:#0d0d0d;display:flex;gap:8px;align-items:flex-end;flex-shrink:0}
.reply-input{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:14px;color:var(--text);outline:none;resize:none;font-family:inherit;line-height:1.5;max-height:100px;transition:border-color .2s}
.reply-input:focus{border-color:var(--gold-dim)}
.reply-input::placeholder{color:var(--dim)}
.reply-send{padding:8px 16px;border-radius:9px;background:var(--gold);color:#080808;border:none;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;flex-shrink:0}
.reply-send:hover:not(:disabled){background:var(--gold2)}
.reply-send:disabled{opacity:.4;cursor:not-allowed}
.mfoot{padding:8px 14px;border-top:1px solid var(--border);display:flex;gap:6px;background:#0d0d0d;flex-shrink:0}
.mfbtn{padding:4px 12px;border-radius:7px;border:1px solid var(--border);background:transparent;font-size:11px;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .15s}
.mfbtn:hover{background:var(--s2);color:var(--text)}
.mfbtn.gold{border-color:var(--gold-dim);color:var(--gold)}
.hist-section{background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:14px 18px}
.hist-label{font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.hist-pills{display:flex;gap:7px;flex-wrap:wrap}
.hpill{padding:5px 12px;background:var(--s2);border:1px solid var(--border);border-radius:18px;font-size:12px;color:var(--muted);cursor:pointer;transition:all .15s;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.hpill:hover{border-color:var(--gold-dim);color:var(--gold2)}
.hwinner{font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:3px;background:rgba(201,168,76,.15);color:var(--gold)}
.tw{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;z-index:999;pointer-events:none}
.toast{background:#111;border:1px solid var(--gold-dim);color:var(--gold2);padding:9px 20px;border-radius:9999px;font-size:13px;font-weight:500;animation:tp 2.8s forwards;white-space:nowrap}
@keyframes tp{0%{opacity:0;transform:translateY(10px)}10%{opacity:1;transform:translateY(0)}85%{opacity:1}100%{opacity:0;transform:translateY(10px)}}
@media(max-width:760px){.mgrid{grid-template-columns:1fr}.mcard{height:400px}.app{padding:14px 12px;gap:14px}}
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="brand">
      <div class="brand-icon"><svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M10 4l6 6-6 6" stroke="#080808" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div><div class="brand-name">CrunchForge</div><div class="brand-sub">Multi-model AI workspace</div></div>
    </div>
    <div class="topbar-right">
      <button class="tbtn" onclick="anonymize()">Anonymize</button>
      <button class="tbtn tbtn-gold" onclick="exportBest()">Export best</button>
    </div>
  </div>
  <div class="divider"></div>
  <div class="ctx-wrap">
    <div class="ctx-top" onclick="toggleCtx()">
      <span class="ctx-label">Project context</span>
      <span class="ctx-toggle" id="ctx-toggle">+ Add context</span>
    </div>
    <div class="ctx-body" id="ctx-body">
      <textarea id="ctx-input" class="ctx-input" placeholder="Paste your project background here. All models read this before every message." rows="4"></textarea>
      <div class="ctx-hint">Sent to every model automatically on every fire and reply.</div>
    </div>
  </div>
  <div class="prompt-zone">
    <div class="pz-top"><span class="pz-label">Fire prompt</span><span class="pz-hint">Cmd+Enter</span></div>
    <textarea id="prompt" class="pta" placeholder="Type once &#8212; all active models receive it simultaneously. Then reply to each one individually below." rows="4"></textarea>
    <div class="pz-row"><div id="toggles" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
    <div class="pz-row">
      <button class="fire-btn" id="fire-btn" onclick="fireAll(false)">Fire all models</button>
      <button class="crunch-btn" id="crunch-btn" onclick="fireAll(true)" disabled>Ultra Crunch</button>
      <button class="reset-btn" onclick="resetAll()">Reset</button>
    </div>
  </div>
  <div class="cn-wrap" id="cn-wrap">
    <div class="cn-top"><span class="cn-label">Crunch direction</span><span class="cn-hint">Optional note before Ultra Crunch</span></div>
    <textarea id="cn-input" class="cn-input" placeholder="e.g. Make it shorter... focus on urgency..." rows="2"></textarea>
  </div>
  <div class="sbar">
    <span class="rl">Round</span>
    <div class="rdots" id="rdots"></div>
    <div class="hdots">
      <div class="hdi"><div class="hd pulse" id="hd-claude"></div>Claude</div>
      <div class="hdi"><div class="hd pulse" id="hd-gpt"></div>GPT</div>
      <div class="hdi"><div class="hd pulse" id="hd-gemini"></div>Gemini</div>
      <div class="hdi"><div class="hd pulse" id="hd-grok"></div>Grok</div>
    </div>
    <span class="rst" id="rst">Ready</span>
  </div>
  <div class="mgrid" id="mgrid"></div>
  <div class="hist-section" id="hist-section" style="display:none">
    <div class="hist-label">Recent sessions</div>
    <div class="hist-pills" id="hist-pills"></div>
  </div>
</div>
<div class="tw" id="toasts"></div>
<script>
const EDGE='https://sfheqjnxlkygjfohoybo.supabase.co/functions/v1';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaGVxam54bGt5Z2pmb2hveWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzNTc3NjUsImV4cCI6MjA4MzkzMzc2NX0.oWEnB48w_k_hOtYM1Ls2AHj8j-THDs_43BBzXrqPyxY';
const AH={'Authorization':'Bearer '+ANON,'Content-Type':'application/json'};
const MODELS=[{id:'claude',label:'Claude',tone:'Strategic builder',hex:'#8b5cf6'},{id:'gpt',label:'ChatGPT',tone:'Broad angle finder',hex:'#10b981'},{id:'gemini',label:'Gemini',tone:'Fast synthesis',hex:'#3b82f6'},{id:'grok',label:'Grok',tone:'Sharp wildcard',hex:'#f59e0b'}];
let S={sid:crypto.randomUUID(),round:1,threads:{claude:[],gpt:[],gemini:[],grok:[]},stat:{},lat:{},best:null,on:['claude','gpt','gemini','grok'],busy:false,hist:[],prompt:'',ctxOpen:false};
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ctx(){return document.getElementById('ctx-input').value.trim();}
function ts(){return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function toggleCtx(){S.ctxOpen=!S.ctxOpen;document.getElementById('ctx-body').classList.toggle('open',S.ctxOpen);document.getElementById('ctx-toggle').textContent=S.ctxOpen?'- Hide':'+ Add context';}
function init(){
  renderToggles();renderGrid();renderDots();loadHist();checkHealth();
  document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!S.busy)fireAll(false);}});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
}
function renderToggles(){
  document.getElementById('toggles').innerHTML=MODELS.map(function(m){return '<button class="mtog '+(S.on.includes(m.id)?'mt-on':''+'" onclick="toggleM(\''+m.id+'\')">'+'<div class="mdot" style="background:'+m.hex+'"></div>'+m.label+'</button>';}).join('');
}
function toggleM(id){if(S.on.includes(id)){if(S.on.length===1)return;S.on=S.on.filter(function(x){return x!==id;});}else{S.on.push(id);}renderToggles();renderGrid();}
function renderDots(){
  var max=Math.max(4,S.round+1);
  document.getElementById('rdots').innerHTML=Array.from({length:max},function(_,i){var n=i+1,c=n<S.round?'done':n===S.round?'active':'';return'<div class="rdot '+c+'">'+n+'</div>';}).join('');
}
async function checkHealth(){
  try{
    var r=await fetch(EDGE+'/crunch?health=1',{headers:{'Authorization':'Bearer '+ANON}});
    var d=await r.json();
    ['claude','gpt','gemini','grok'].forEach(function(k){var dot=document.getElementById('hd-'+k);if(dot)dot.className='hd '+(d.checks&&d.checks[k]?'ok':'err');});
  }catch(e){['claude','gpt','gemini','grok'].forEach(function(k){var d=document.getElementById('hd-'+k);if(d)d.className='hd err';});}
}
function renderThread(id){
  var t=S.threads[id]||[],st=S.stat[id]||'idle';
  if(!t.length&&st!=='thinking')return '<div class="chat-empty">Fire a prompt to start the conversation</div>';
  var h=t.map(function(m){return'<div class="msg '+m.role+'"><div class="msg-bubble">'+esc(m.content)+'</div><div class="msg-time">'+m.time+'</div></div>';}).join('');
  if(st==='thinking')h+='<div class="msg assistant"><div class="msg-bubble" style="min-width:140px"><div class="sh-line"></div><div class="sh-line" style="width:60%"></div></div></div>';
  return h;
}
function renderGrid(){
  document.getElementById('mgrid').innerHTML=MODELS.map(function(m){
    var on=S.on.includes(m.id),st=S.stat[m.id]||'idle',ib=S.best===m.id;
    var lat=S.lat[m.id]?((S.lat[m.id]/1000).toFixed(1)+'s'):'';
    var pm={idle:'sp-idle',thinking:'sp-thinking',done:'sp-done',error:'sp-error'};
    var lm={idle:'idle',thinking:'thinking...',done:'active',error:'error'};
    return '<div class="mcard '+(ib?'winner':'')+' '+(!on?'off':'')+'">'
      +'<div class="mhead"><div class="mname-wrap"><div class="mcdot" style="background:'+m.hex+'"></div><div><div class="mname">'+m.label+'</div><div class="mtone">'+m.tone+'</div></div></div>'+(lat?'<span class="mlat">'+lat+'</span>':'')+'<span class="spill '+pm[st]+'">'+lm[st]+'</span></div>'
      +'<div class="chat-thread" id="thread-'+m.id+'">'+renderThread(m.id)+'</div>'
      +'<div class="reply-zone"><textarea class="reply-input" id="ri-'+m.id+'" placeholder="Reply to '+m.label+'..." rows="1" onkeydown="handleKey(event,\''+m.id+'\')" oninput="autoH(this)"></textarea><button class="reply-send" id="rs-'+m.id+'" onclick="sendReply(\''+m.id+'\')" '+(st==='thinking'?'disabled':'')+'>Send</button></div>'
      +'<div class="mfoot"><button class="mfbtn" onclick="copyThread(\''+m.id+'\')}">Copy all</button><button class="mfbtn '+(ib?'gold':'')+'>" onclick="markBest(\''+m.id+'\')}">'+(ib?'&#9733; Best':'&#9734; Best')+'</button></div>'
      +'</div>';
  }).join('');
  MODELS.forEach(function(m){var el=document.getElementById('thread-'+m.id);if(el)el.scrollTop=el.scrollHeight;});
}
function autoH(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px';}
function handleKey(e,id){if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();sendReply(id);}}
function scrollT(id){var el=document.getElementById('thread-'+id);if(el)setTimeout(function(){el.scrollTop=el.scrollHeight;},50);}
async function sendReply(id){
  var input=document.getElementById('ri-'+id);
  var msg=input.value.trim();
  if(!msg){toast('Type a message first');return;}
  S.threads[id].push({role:'user',content:msg,time:ts()});
  S.stat[id]='thinking';
  input.value='';input.style.height='auto';
  document.getElementById('rs-'+id).disabled=true;
  renderGrid();scrollT(id);
  var history=S.threads[id].slice(0,-1).map(function(m){return{role:m.role,content:m.content};});
  try{
    var res=await fetch(EDGE+'/crunch',{method:'POST',headers:AH,body:JSON.stringify({sessionId:S.sid,round:S.round,context:ctx(),threadModel:id,threadMessage:msg,threadHistory:history})});
    var d=await res.json();
    if(d.error)throw new Error(d.error);
    S.threads[id].push({role:'assistant',content:d.reply,time:ts()});
    S.lat[id]=d.latency||0;S.stat[id]='done';
    toast((MODELS.find(function(m){return m.id===id;})||{label:id}).label+' replied');
  }catch(e){
    S.threads[id].push({role:'assistant',content:'Error: '+e.message,time:ts()});
    S.stat[id]='error';toast('Error: '+e.message);
  }
  document.getElementById('rs-'+id).disabled=false;
  renderGrid();scrollT(id);
}
async function fireAll(isCrunch){
  var p=document.getElementById('prompt').value.trim();
  if(!p&&!isCrunch){toast('Enter a prompt first');return;}
  var snapshot={};
  if(isCrunch){S.on.forEach(function(m){var last=S.threads[m].filter(function(x){return x.role==='assistant';}).pop();if(last)snapshot[m]=last.content;});}
  var cn=isCrunch?(document.getElementById('cn-input').value.trim()||'):'';
  S.busy=true;S.best=null;
  document.getElementById('fire-btn').disabled=true;
  document.getElementById('crunch-btn').disabled=true;
  if(!isCrunch)S.on.forEach(function(m){S.threads[m]=[];});
  S.on.forEach(function(m){S.stat[m]='thinking';});
  renderGrid();
  var rs=document.getElementById('rst');rs.className='rst live';rs.textContent=isCrunch?'Ultra crunching...':'Firing all models...';
  try{
    var res=await fetch(EDGE+'/crunch',{method:'POST',headers:AH,body:JSON.stringify({firePrompt:p||S.prompt,prevResponses:snapshot,crunchNote:cn,context:ctx(),sessionId:S.sid,round:S.round,isNew:S.round===1&&!isCrunch,isCrunch:isCrunch,models:S.on})});
    var d=await res.json();
    if(d.error)throw new Error(d.error);
    var results=d.results||d,lats=d.latencies||{},t=ts();
    S.on.forEach(function(m){
      var resp=results[m]||'';
      if(!resp.startsWith('Error')){
        if(!isCrunch){S.threads[m]=[{role:'user',content:p||S.prompt,time:t},{role:'assistant',content:resp,time:t}];}
        else{S.threads[m].push({role:'assistant',content:'[Ultra Crunch] '+resp,time:t});}
        S.stat[m]='done';
      }else{
        S.threads[m].push({role:'assistant',content:resp,time:t});
        S.stat[m]='error';
      }
      S.lat[m]=lats[m]||0;
    });
    if(p)S.prompt=p;S.round++;renderDots();
    var won=S.on.filter(function(m){return S.stat[m]==='done';}).length;
    rs.className='rst';rs.textContent='Round '+(S.round-1)+' done \u2014 '+won+'/'+S.on.length+' ready';
    document.getElementById('crunch-btn').disabled=false;
    document.getElementById('cn-wrap').classList.add('show');
    loadHist();toast('Round '+(S.round-1)+' complete \u2014 reply to any model below');
  }catch(e){
    S.on.forEach(function(m){S.stat[m]='error';S.threads[m].push({role:'assistant',content:'Error: '+e.message,time:ts()});});
    rs.className='rst';rs.textContent='Error \u2014 check API keys';toast('Error: '+e.message);
  }
  S.busy=false;document.getElementById('fire-btn').disabled=false;
  renderGrid();S.on.forEach(function(m){scrollT(m);});
}
async function markBest(id){
  S.best=S.best===id?null:id;renderGrid();
  if(S.best){
    toast((MODELS.find(function(m){return m.id===id;})||{label:id}).label+' marked as best');
    try{await fetch(EDGE+'/crunch',{method:'PATCH',headers:AH,body:JSON.stringify({sessionId:S.sid,winner:S.best})});}catch(e){}
    loadHist();
  }
}
function copyThread(id){
  var t=S.threads[id]||[];
  if(!t.length){toast('No messages yet');return;}
  navigator.clipboard.writeText(t.map(function(m){return(m.role==='user'?'You: ':'AI: ')+m.content;}).join('\n\n')).then(function(){toast('Thread copied!');});
}
function exportBest(){
  if(!S.best){toast('Mark a best model first');return;}
  var t=S.threads[S.best]||[];
  var label=(MODELS.find(function(m){return m.id===S.best;})||{label:S.best}).label;
  var text='# CrunchForge \u2014 '+label+'\n\nPrompt: '+S.prompt+'\n\n---\n\n'+t.map(function(m){return(m.role==='user'?'**You:** ':'**'+label+':** ')+m.content;}).join('\n\n');
  var b=new Blob([text],{type:'text/markdown'}),u=URL.createObjectURL(b),a=document.createElement('a');
  a.href=u;a.download='crunch-'+(new Date().toISOString().slice(0,10))+'.md';a.click();URL.revokeObjectURL(u);toast('Exported!');
}
function anonymize(){
  var p=document.getElementById('prompt'),before=p.value;
  p.value=p.value.replace(/\b(Thom|Thomas|Sto|Chrissy|Christine|Pete|Peter|Moe|Mohamed|Danielle|Vogel|Sahar|Speaker\s*\d+|Caller|Respondent)\b/gi,'[REDACTED]');
  toast(p.value!==before?'Names anonymized':'No names found');
}
async function loadHist(){
  try{
    var r=await fetch(EDGE+'/crunch-history',{headers:{'Authorization':'Bearer '+ANON}});
    var d=await r.json();S.hist=Array.isArray(d)?d:[];renderHist();
  }catch(e){}
}
function renderHist(){
  var sec=document.getElementById('hist-section'),el=document.getElementById('hist-pills');
  if(!S.hist.length){sec.style.display='none';return;}
  sec.style.display='block';
  el.innerHTML=S.hist.slice(0,15).map(function(s){
    var display=s.title||(s.prompt||'').slice(0,40)||s.id.slice(0,8);
    var w=s.winner?'<span class="hwinner">'+s.winner+'</span>':'';
    return '<div class="hpill" onclick="loadSess(\''+s.id+'\')}">'+esc(display)+w+'</div>';
  }).join('');
}
async function loadSess(id){
  toast('Loading...');
  try{
    var r=await fetch(EDGE+'/crunch-history?sessionId='+id,{headers:{'Authorization':'Bearer '+ANON}});
    var d=await r.json();
    if(d.session){document.getElementById('prompt').value=d.session.prompt||'';S.prompt=d.session.prompt||'';S.sid=id;}
    S.threads={claude:[],gpt:[],gemini:[],grok:[]};
    if(d.responses&&d.responses.length){
      var maxR=Math.max.apply(null,d.responses.map(function(r){return r.round;}));
      S.round=maxR+1;
      d.responses.filter(function(r){return r.round===maxR;}).forEach(function(r){
        S.threads[r.model]=[{role:'user',content:d.session.prompt||'',time:''},{role:'assistant',content:r.response,time:''}];
        S.stat[r.model]='done';
      });
    }else{S.round=1;S.stat={};}
    S.best=d.session&&d.session.winner?d.session.winner:null;
    renderGrid();renderDots();
    if(!Object.values(S.threads).every(function(t){return !t.length;}))document.getElementById('cn-wrap').classList.add('show');
    toast('Session loaded');
    MODELS.forEach(function(m){scrollT(m.id);});
  }catch(e){toast('Load failed');}
}
function resetAll(){
  S.sid=crypto.randomUUID();S.round=1;
  S.threads={claude:[],gpt:[],gemini:[],grok:[]};
  S.stat={};S.lat={};S.best=null;S.busy=false;S.prompt='';
  document.getElementById('prompt').value='';
  document.getElementById('cn-input').value='';
  document.getElementById('cn-wrap').classList.remove('show');
  document.getElementById('fire-btn').disabled=false;
  document.getElementById('crunch-btn').disabled=true;
  document.getElementById('rst').textContent='Ready';
  document.getElementById('rst').className='rst';
  renderGrid();renderDots();
}
function toast(msg){var w=document.getElementById('toasts'),t=document.createElement('div');t.className='toast';t.textContent=msg;w.appendChild(t);setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},2900);}
init();
<\/script>
</body>
</html>`;

Deno.serve(async (req: Request) => {
  // Serve the app on any path under this function
  return new Response(HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})
