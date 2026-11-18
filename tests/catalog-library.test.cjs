'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const appSource=fs.readFileSync('app.js','utf8');
const addonSource=fs.readFileSync('addons.js','utf8');
const html=fs.readFileSync('index.html','utf8');

function fakeStorage(initial={}){
 const entries=new Map(Object.entries(initial));
 return {getItem:k=>entries.has(k)?entries.get(k):null,
   setItem:(k,v)=>entries.set(k,String(v)),
   removeItem:k=>entries.delete(k),entries};
}
function dom(){
 const nodes=new Map();
 const node=k=>{
  if(!nodes.has(k))nodes.set(k,{innerHTML:'',value:'',textContent:'',dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){},setSelectionRange(){},querySelector(){return null}});
  return nodes.get(k);
 };
 const document={querySelector:node,querySelectorAll:()=>[],createElement:()=>node('created'),addEventListener(){},documentElement:{style:{setProperty(){}},dataset:{}},body:{classList:{add(){},remove(){}}}};
 return {document,node,nodes};
}

function appHarness(){
 const storage=fakeStorage({
  'luma.v2.watch':JSON.stringify(['saved-1']),
  'luma.device.titles.v1':JSON.stringify({'saved-1':{id:'saved-1',title:'Cached television series',type:'Series',year:'2020',source:'tvmaze'}})
 });
 const {document,node}=dom();
 const ctx={document,localStorage:storage,window:{addEventListener(){}},location:{origin:'https://example.test'},navigator:{},
  LumaReleases:{all:()=>[],label:()=>'',refresh:async()=>{},homepage:()=>'',releasePage:()=>'',bind(){}},
  LumaCalendar:{prime:async()=>{},homeMarkup:()=>'',bindHome(){},registerFollow(){}},
  LumaAddons:{render(){}},
  LumaPeople:{markup:()=>'',bind(){}},
  LumaAccounts:{deviceItems:()=>JSON.parse(storage.getItem('luma.v2.watch')||'[]').map(id=>JSON.parse(storage.getItem('luma.device.titles.v1')||'{}')[id]).filter(Boolean),watchlistMarkup:()=>'',watchlistBind(){}},
  fetch:async(url)=>({ok:true,json:async()=>url.includes('tvmaze')?[]:{feed:{entry:[]}}}),
  AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console,scrollTo(){}};
 vm.createContext(ctx);
 vm.runInContext(appSource,ctx);
 return {ctx,node,storage,run:(js)=>vm.runInContext(js,ctx)};
}
function addonHarness(){
 const manifest={id:'test.metadata',name:'Fixture Catalog',version:'1.0.0',types:['movie','series'],resources:['catalog','meta'],catalogs:[{type:'movie',id:'top',name:'Top',extra:[{name:'search'},{name:'skip'}]}]};
 const storage=fakeStorage({'luma.addons.v1':JSON.stringify([{url:'https://fixture.example/manifest.json',manifest,enabled:true}])});
 const {document,node}=dom();
 const calls=[];
 const ctx={document,localStorage:storage,window:{},state:{tab:'Add-ons',q:'',progress:{}},toast(){},safe:x=>String(x),$:(selector)=>node(selector),$$:()=>[],render(){},modal(){},closeModal(){},play(){},confirm:()=>true,
  fetch:async(url)=>{
   calls.push(url);
   let metas=[];
   if(url.includes('/catalog/movie/top.json'))metas=Array.from({length:30},(_,i)=>({id:'tt'+String(i+100000).padStart(7,'0'),name:'Movie '+i,type:'movie',releaseInfo:'2025'}));
   if(url.includes('/skip=30.json'))metas=Array.from({length:10},(_,i)=>({id:'tt'+String(i+100030).padStart(7,'0'),name:'Movie '+(30+i),type:'movie',releaseInfo:'2026'}));
   if(url.includes('/search='))metas=[{id:'tt1009999',name:'Searched Movie',releaseInfo:'2024'}];
   return {ok:true,text:async()=>JSON.stringify({metas})};
  },AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console};
 node('#navigation').querySelector=()=>({}); // Existing nav already contains Add-ons.
 vm.createContext(ctx);vm.runInContext(addonSource,ctx);
 return {ctx,node,storage,calls,run:(js)=>vm.runInContext(js,ctx)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('standalone HTML includes updated app and add-on modules',()=>{
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1].trim());
 assert.ok(scripts.includes(appSource.trim()),'app.js must match the served standalone script');
 assert.ok(scripts.includes(addonSource.trim()),'addons.js must match the served standalone script');
 assert.match(html,/id="luma-collections"/);
});
test('catalog page exposes sorting, filters, and paginated results',()=>{
 const x=appHarness();
 x.run("state.items=Array.from({length:52},(_,i)=>({id:'film-'+i,title:'Film '+i,type:'Movie',source:'tmdb',year:'2025',genreNames:['Action']}));state.tab='Catalogs';render()");
 const body=x.node('#content').innerHTML;
 assert.match(body,/Explore movies, series and anime/);
 assert.match(body,/Page 1 of 3/);
 assert.match(body,/id="catalogType"/);
 assert.match(body,/id="catalogSort"/);
 x.run("browse.page=2;render()");
 assert.match(x.node('#content').innerHTML,/Page 3 of 3/);
 assert.match(x.node('#content').innerHTML,/Film 50/);
});
test('local library preserves cached watchlist, watched titles and personal media',()=>{
 const x=appHarness();
 const snapshot=x.storage.getItem('luma.device.titles.v1');
 x.run("state.items=[{id:'watched-1',title:'Already watched',type:'Movie',source:'itunes'}];state.watched=['watched-1'];state.library=[{id:'local-1',title:'Personal film',type:'Movie',url:'https://example.test/movie.mp4'}];state.tab='My Library';render()");
 const page=x.node('#content').innerHTML;
 assert.match(page,/Everything you saved, in one place/);
 assert.match(page,/Cached television series/);
 assert.match(page,/Already watched/);
 assert.match(page,/Personal film/);
 assert.match(page,/data-library-section="saved"/);
 x.run("libraryView.section='saved';render()");
 assert.match(x.node('#content').innerHTML,/Cached television series/);
 assert.doesNotMatch(x.node('#content').innerHTML,/Personal film<\/b>/);
 assert.equal(x.storage.getItem('luma.device.titles.v1'),snapshot,'Browsing must not mutate watchlist snapshots');
});
test('library pagination supports more than 24 saved titles without data loss',()=>{
 const x=appHarness();
 const ids=Array.from({length:52},(_,i)=>'saved-'+i);
 const snapshots=Object.fromEntries(ids.map((id,i)=>[id,{id,title:'Saved '+i,type:'Movie'}]));
 x.storage.setItem('luma.v2.watch',JSON.stringify(ids));
 x.storage.setItem('luma.device.titles.v1',JSON.stringify(snapshots));
 x.run("state.watch=JSON.parse(localStorage.getItem('luma.v2.watch'));state.tab='My Library';libraryView.section='saved';render()");
 assert.match(x.node('#content').innerHTML,/Page 1 of 3/);
 x.run('libraryView.page=2;render()');
 assert.match(x.node('#content').innerHTML,/Page 3 of 3/);
 assert.match(x.node('#content').innerHTML,/Saved 50/);
 assert.equal(JSON.parse(x.storage.getItem('luma.v2.watch')).length,52);
});
test('Stremio browser fetches later skip pages and never rewrites installed add-ons',async()=>{
 const x=addonHarness();
 const before=x.storage.getItem('luma.addons.v1');
 x.run('LumaAddons.render()');
 x.node('#addonBrowse').onclick();
 await flush();
 assert.ok(x.calls.some(url=>url.endsWith('/catalog/movie/top.json')));
 assert.match(x.node('#content').innerHTML,/30 loaded/);
 assert.match(x.node('#content').innerHTML,/id="addonMore"/);
 await x.node('#addonMore').onclick();
 assert.ok(x.calls.some(url=>url.includes('/skip=30.json')));
 assert.match(x.node('#content').innerHTML,/40 loaded/);
 assert.match(x.node('#content').innerHTML,/Page 1 of 2/);
 assert.equal(x.storage.getItem('luma.addons.v1'),before);
});
test('addon catalog exposes local source, type, genre and sort filters',async()=>{
 const x=addonHarness();
 x.run('LumaAddons.render()');x.node('#addonBrowse').onclick();
 await flush();
 const page=x.node('#content').innerHTML;
 for(const id of ['addonSearch','addonLocalFilter','addonType','addonProvider','addonGenre','addonSort','addonRunSearch'])assert.ok(page.includes('id="'+id+'"'),id);
 x.node('#addonType').onchange({target:{value:'Series'}});
 assert.match(x.node('#content').innerHTML,/No matching titles/);
});
