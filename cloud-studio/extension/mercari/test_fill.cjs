const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<main><input data-testid="Title"><textarea data-testid="Description"></textarea><button data-testid="SellCategoryFieldButton">Select category</button><input data-testid="Brand"><div role="radiogroup"><label><input type="radio" name="condition">NewNew with tags.</label><label><input type="radio" name="condition">GoodGently used.</label></div><input data-testid="SellPhotoInput" type="file" multiple><input data-testid="Price"><button data-testid="ListButton">List</button><button data-testid="SaveDraftButton">Save draft</button></main>',{url:'https://www.mercari.com/sell/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.Element.prototype.getClientRects=function(){return [1];};
class Transfer{constructor(){this.files=[];this.items={add:f=>this.files.push(f)};}}w.DataTransfer=Transfer;
const photo=d.querySelector('[type=file]');Object.defineProperty(photo,'files',{value:[],writable:true});
let published=0,saved=0,level=0;
d.querySelector('[data-testid=ListButton]').onclick=()=>published++;
d.querySelector('[data-testid=SaveDraftButton]').onclick=()=>saved++;
const names=['Electronics','Home Audio','Home Speakers'];
function categoryDialog(){d.querySelector('[role=dialog]')?.remove();const dialog=d.createElement('div');dialog.setAttribute('role','dialog');const b=d.createElement('button');b.dataset.testid='CategoryRow';b.textContent=names[level];b.onclick=()=>{if(++level===3){dialog.remove();d.querySelector('[data-testid=SellCategoryFieldButton]').textContent=names.join(' > ');}else categoryDialog();};dialog.append(b);d.body.append(dialog);}
d.querySelector('[data-testid=SellCategoryFieldButton]').onclick=categoryDialog;
d.querySelector('[data-testid=Brand]').oninput=()=>{d.querySelector('[role=option]')?.remove();const choice=d.createElement('button');choice.setAttribute('role','option');choice.textContent='KEF';choice.onclick=()=>choice.remove();d.body.append(choice);};
w.eval(fs.readFileSync(__dirname+'/fill.js','utf8'));
(async()=>{
 const draft={title:'KEF speaker',description:'Speaker with a scratched cabinet. Includes cable.',price:'100',condition:'Good',brand:'KEF',category_path:names,files:[{base64:Buffer.from([255,216,255,0]).toString('base64'),mime:'image/jpeg',name:'01.jpg'}],shipping:{}};
 const result=await w.CMMercariForm.fill(draft);
 assert.equal(d.querySelector('[data-testid=Title]').value,draft.title);assert.equal(d.querySelector('[data-testid=Description]').value,draft.description);assert.equal(d.querySelector('[data-testid=Price]').value,'100');assert.equal(photo.files.length,1);assert.equal(photo.files[0].name,'01.jpg');assert.equal(d.querySelectorAll('[type=radio]')[1].checked,true);assert.ok(result.done.includes('Category'));assert.ok(result.done.includes('Brand'));assert.equal(published,0);assert.equal(saved,0);
 await assert.rejects(w.CMMercariForm.fill(draft),/already contains a draft/);
 assert.equal(d.querySelector('[data-testid=Title]').value,draft.title);
 console.log('PASS: exact Mercari form controls, category, brand, condition, text readback and attached file; refuses existing draft; never publishes or saves.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
