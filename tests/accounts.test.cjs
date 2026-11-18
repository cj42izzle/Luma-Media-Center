'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('accounts.js', 'utf8');
function setup(responses = [], initialAccount = null) {
  const stored = new Map([['luma.device.titles.v1', JSON.stringify({local1: {id:'local1',title:'Local saved movie',type:'Movie'}})]]);
  if (initialAccount) stored.set('luma.accounts.v1', JSON.stringify(initialAccount));
  const buttons = [{dataset:{deviceConnect:'trakt'},onclick:null},{dataset:{deviceConnect:'simkl'},onclick:null}];
  const browserButtons = [{dataset:{browserConnect:'trakt'},onclick:null},{dataset:{browserConnect:'simkl'},onclick:null}];
  const localStorage = {getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
  const nodes = new Map();
  function element(id) { if (!nodes.has(id)) nodes.set(id, {id,hidden:true,value:'',textContent:'',href:'',classList:{toggle(){}},focus(){},onclick:null}); return nodes.get(id); }
  const calls=[]; const timers=new Map(); let nextTimer=1; let now=100000;
  const state={tab:'',watch:['local1'],items:[]};
  const context={location:{origin:'https://example.test',pathname:'/luma/'},localStorage,sessionStorage:localStorage,state,
    safe:String,toast(){},render(){},$:(selector)=>element(selector.replace(/^#/,'')), $$:(selector)=> selector==='[data-device-connect]' ? buttons : selector==='[data-browser-connect]' ? browserButtons : [],
    crypto:{subtle:{}},Date:class extends Date {static now(){return now}},
    setTimeout:(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id},
    clearTimeout:(id)=>timers.delete(id),
    AbortController, URL,URLSearchParams, console,
    fetch:async(url,opts)=>{calls.push({url,opts}); const response=responses.shift(); if(!response)throw Error('Unexpected fetch');return {ok:response.ok,status:response.status,json:async()=>response.body};}
  };
  vm.createContext(context);vm.runInContext(source+'\nthis.accounts=LumaAccounts;',context);
  return {app:context.accounts,store:stored,element,buttons,browserButtons,calls,timers,state,setNow:v=>now=v, runTimer:async()=>{const [id,t]=timers.entries().next().value;timers.delete(id);await t.fn();}};
}

test('source selection remains isolated and on-device snapshots survive',()=>{
  const x=setup();
  assert.equal(x.app.chosenItems()[0].title,'Local saved movie');
  x.app.choose('trakt');assert.equal(x.app.chosenItems().length,0);
  x.app.choose('simkl');assert.equal(x.app.chosenItems().length,0);
  x.app.choose('invalid');assert.equal(x.app.getSource(),'simkl');
  x.app.choose('device');assert.equal(x.app.chosenItems()[0].id,'local1');
  assert.match(x.store.get('luma.device.titles.v1'),/Local saved movie/);
});
test('settings expose both code flows and all activation controls',()=>{
  const html=setup().app.settingsMarkup();
  for(const field of ['data-browser-connect="trakt"','data-browser-connect="simkl"','data-device-connect="trakt"','data-device-connect="simkl"','id="deviceCodePanel"','id="deviceUserCode"','id="deviceCheckNow"','id="deviceCancel"','id="traktClientId"','id="simklClientId"'])assert.ok(html.includes(field),field);
});
test('missing public client ID blocks device-code request',async()=>{
  const x=setup();x.app.bindSettings();
  await x.buttons[0].onclick();
  assert.equal(x.calls.length,0);
  assert.equal(x.element('accountAdvanced').open,true);
});
test('activation pending, polling interval, and denial never create tokens',async()=>{
  const x=setup([
    {ok:true,status:200,body:{device_code:'dev',user_code:'ABC',expires_in:600,interval:5}},
    {ok:false,status:400,body:{error:'authorization_pending'}},
    {ok:false,status:403,body:{error:'access_denied'}}
  ],{ids:{trakt:'12345678',simkl:''}});
  x.app.bindSettings();await x.buttons[0].onclick();
  assert.equal(x.element('deviceUserCode').textContent,'ABC');
  assert.equal(x.calls.length,1);
  await x.runTimer();assert.equal(x.calls.length,2);
  await x.element('deviceCheckNow').onclick();
  assert.equal(x.calls.length,2,'Manual polling must respect provider interval');
  x.setNow(106000);await x.element('deviceCheckNow').onclick();
  assert.equal(x.calls.length,3);
  assert.equal(x.app.online('trakt'),false);
  assert.equal(x.app.getSource(),'device');
});
test('expired activation codes stop without token request',async()=>{
  const x=setup([{ok:true,status:200,body:{device_code:'dev',user_code:'ABC',expires_in:60,interval:5}}],{ids:{trakt:'12345678',simkl:''}});
  x.app.bindSettings();await x.buttons[0].onclick();
  x.setNow(161000);await x.element('deviceCheckNow').onclick();
  assert.equal(x.calls.length,1);
  assert.match(x.element('deviceCodeStatus').textContent,/expired/);
});

test('main browser login does not redirect without registered public ID',async()=>{
 const x=setup();x.app.bindSettings();
 await x.browserButtons[0].onclick();
 assert.equal(x.calls.length,0);
 assert.equal(x.element('accountAdvanced').open,true);
});
test('account setup and public app IDs do not mutate local watchlist',()=>{
 const x=setup();const before=x.store.get('luma.device.titles.v1');
 const html=x.app.settingsMarkup();
 assert.match(html,/One-time app setup \(site owner only\)/);
 assert.match(html,/Connect TRAKT/);
 assert.match(html,/Connect SIMKL/);
 assert.equal(x.store.get('luma.device.titles.v1'),before);
});
