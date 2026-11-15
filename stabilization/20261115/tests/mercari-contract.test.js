'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const copySource=fs.readFileSync(path.join(root,'live-vercel/src/mercari-copy.js'),'utf8');
const context={structuredClone,URL};
context.globalThis=context;
vm.runInNewContext(copySource,context,{filename:'mercari-copy.js'});
const copy=context.MercariCopy;

assert.equal(copy.condition('New'),'New');
assert.equal(copy.condition('Used - Good'),'Good');
assert.equal(copy.condition('Mystery Grade'),'','unknown nonblank conditions must never become New');
assert.equal(copy.condition(''),'New','blank source condition follows the visible Assumed New account policy');

const source={fields:{price:'100',condition:'Used - Good',description:'Product facts'},photos:[{url:'https://example.invalid/a.jpg'}]};
const prepared=copy.prepare(source,copy.shipping());
assert.equal(prepared.price,'110.00');
assert.equal(prepared.condition,'Good');
assert.equal(Object.hasOwn(prepared,'photos_confirmed'),false,'hidden photo confirmation must not return');

const edited=copy.defaults({...prepared,price:'123.45',condition:'Fair'},source);
assert.equal(edited.price,'123.45','seller price must survive defaults');
assert.equal(edited.condition,'Fair','seller condition must survive defaults');

const manifest=JSON.parse(fs.readFileSync(path.join(root,'companion/extracted/CrazyMoe-Mercari-Companion/manifest.json'),'utf8'));
assert.equal(manifest.version,'2.4.0');
const worker=fs.readFileSync(path.join(root,'companion/extracted/CrazyMoe-Mercari-Companion/automation-worker.js'),'utf8');
assert.match(worker,/CM_CONTRACT='mercari-2026-11-15\.1'/);
assert.match(worker,/p\.server_ready!==true/);

const studio=fs.readFileSync(path.join(root,'live-vercel/src/mercari.js'),'utf8');
assert.match(studio,/COMPANION_VERSION='2\.4\.0'/);
assert.doesNotMatch(studio,/parseFloat\(currentVersion\)/);
assert.doesNotMatch(studio,/photos_confirmed:true/);

console.log('Mercari contract tests passed');
