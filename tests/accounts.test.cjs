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
  for(const field of ['data-browser-connect="trakt"','data-browser-connect="simkl"','data-device-connect="trakt"','id="deviceCodePanel"','id="deviceUserCode"','id="deviceCheckNow"','id="deviceCancel"','id="traktClientId"','id="simklClientId"'])assert.ok(html.includes(field),field);
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

test('Simkl completed and dropped categories remain visible without mutating original lists',()=>{
 const x=setup();
 const result=x.app.decodeList('simkl',{
  movies:[{movie:{title:'Completed Movie',ids:{imdb:'tt1234567'}},status:'completed'}],
  shows:[{show:{title:'Dropped Show',ids:{simkl:98765}},status:'dropped'}],
  anime:[{anime:{title:'Upcoming Anime',ids:{simkl:45678}},status:'plantowatch'}]
 });
 assert.equal(result.length,3);
 assert.deepEqual([...result.map(v=>v.userStatus)].sort(),['completed','dropped','plantowatch']);
});
test('cloud libraries have search, status, source, and pagination controls',()=>{
 const titles=Array.from({length:52},(_,i)=>({id:'simkl:imdb:tt'+(1000000+i),title:'Film '+i,type:'Movie',source:'simkl',userStatus:i%2?'completed':'plantowatch',year:'2025'}));
 const x=setup([],{lists:{trakt:[],simkl:titles}});
 x.app.choose('simkl');
 const html=x.app.watchlistMarkup();
 for(const id of ['watchCombined','watchSearch','watchType','watchStatus','watchSort','watchNext'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/Page 1 of 3/);
 assert.match(html,/Film 0/);
 assert.equal(x.store.get('luma.device.titles.v1').includes('Local saved movie'),true);
});
test('account view does not require a cloud service to show local titles',()=>{
 const x=setup([],{source:'device',lists:{trakt:[],simkl:[]}});
 const html=x.app.watchlistMarkup();
 assert.match(html,/Local saved movie/);
 assert.match(html,/Browse all libraries together/);
 assert.equal(x.app.getSource(),'device');
});

test('Simkl browser sign-in is primary; device activation requires a separate registered client ID',()=>{
 const ordinary=setup().app.settingsMarkup();
 assert.match(ordinary,/data-browser-connect="simkl"/);
 assert.doesNotMatch(ordinary,/data-device-connect="simkl"/);
 assert.match(ordinary,/id="simklDeviceClientId"/);
 const configured=setup([],{ids:{trakt:'',simkl:'87654321',simklDevice:'12345678'}}).app.settingsMarkup();
 assert.match(configured,/data-device-connect="simkl"/);
});
test('Simkl API requests use the client ID that actually issued the user token',async()=>{
 const x=setup([
  {ok:true,status:200,body:{all:'2026-01-01'}},
  {ok:true,status:200,body:{shows:[],movies:[],anime:[]}}
 ],{ids:{trakt:'',simkl:'browser123',simklDevice:'device123'},
     tokens:{trakt:null,simkl:{access_token:'token',refresh_token:'',client_id:'device123',expires_at:9999999999}}});
 const ok=await x.app.sync('simkl',true);
 assert.equal(ok,true);
 assert.ok(x.calls.length>=2);
 assert.ok(x.calls.every(call=>String(call.url).includes('client_id=device123')));
 assert.ok(x.calls.every(call=>!String(call.url).includes('browser123')));
});

test('missing metadata never fabricates a movie called Saved title',()=>{
 const x=setup();
 x.state.watch=['unknown-provider-id'];
 const row=x.app.deviceItems()[0];
 assert.equal(row.unresolved,true);
 assert.equal(row.title,'Metadata unavailable');
 assert.equal(row.type,'Unknown');
 assert.equal(x.store.get('luma.device.titles.v1').includes('Local saved movie'),true);
});
