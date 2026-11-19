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
  LumaCollections:{collectionID:(title,page)=>page==="TV Shows"?"series":page==="Movies"?"movies":"discover",providerShowcase:()=>"",renderCollection:()=>"",bind(){},find:()=>null,open(){}},
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
test('Luma add-on browser fetches later skip pages and never rewrites installed add-ons',async()=>{
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

test('TMDB movie genres and anime classification use provider IDs',()=>{
 const x=appHarness();
 const movie=x.run("normalizeTMDB({id:77,media_type:'movie',title:'Example',genre_ids:[28,53],release_date:'2026-06-01'})");
 assert.equal(movie.type,'Movie');
 assert.deepEqual([...movie.genreNames],['Action','Thriller']);
 const anime=x.run("normalizeTMDB({id:10,media_type:'tv',name:'Example Anime',original_language:'ja',genre_ids:[16],first_air_date:'2025-01-01'})");
 assert.equal(anime.type,'Anime');
 assert.ok(anime.genreNames.includes('Animation'));
});
test('episode playback is linked to its parent series in Continue Watching',()=>{
 const x=appHarness();
 x.run("state.items=[{id:'tvmaze:90',title:'Seasonal Show',type:'Series',year:'2024'}];state.progress={'tvmaze:90:s1e2':{fraction:.46,seconds:880,updated:12345}};state.tab='Continue Watching';render()");
 const page=x.node('#content').innerHTML;
 assert.match(page,/Seasonal Show/);
 assert.match(page,/Resume S1E2/);
 assert.equal(x.run("libraryGroups().watching.length"),1);
});
test('restore merge keeps existing device watchlists and title snapshots',()=>{
 const x=appHarness(),snapshot=JSON.parse(x.storage.getItem('luma.device.titles.v1'));
 x.run("applyBackup(cleanBackup({watch:['new-title'],watched:['watched-new'],library:[{id:'local-new',title:'Restored movie',type:'Movie',url:'https://example.test/a.mp4'}],watchDetails:{'new-title':{title:'Restored title',type:'Movie'}}}),false)");
 assert.deepEqual(JSON.parse(x.storage.getItem('luma.v2.watch')),['saved-1','new-title']);
 assert.equal(JSON.parse(x.storage.getItem('luma.device.titles.v1'))['saved-1'].title,snapshot['saved-1'].title);
 assert.equal(JSON.parse(x.storage.getItem('luma.v2.library')).length,1);
});
test('backup validation rejects malformed data before changing persistent storage',()=>{
 const x=appHarness(),before=x.storage.getItem('luma.v2.watch');
 assert.throws(()=>x.run("cleanBackup({library:{id:'bad'}})"),/not a supported Luma backup|Invalid personal library/);
 assert.throws(()=>x.run("cleanBackup({watch:'wrong',library:[]})"),/Invalid title IDs/);
 const ok=x.run("cleanBackup({watch:['good'],library:[{id:'new',title:'Title',type:'Movie',url:'http://unsafe.example/a.mp4'}]})");
 assert.equal(ok.library[0].url,'');
 assert.equal(x.storage.getItem('luma.v2.watch'),before);
});
test('personal collections are filterable without altering saved titles',()=>{
 const x=appHarness();
 x.run("state.library=[{id:'personal1',title:'Family Film',type:'Movie',collection:'Family'},{id:'personal2',title:'Sci-Fi Movie',type:'Movie',collection:'Favorites'}];state.tab='My Library';libraryView.collection='Family';render()");
 const page=x.node('#content').innerHTML;
 assert.match(page,/Family Film/);
 assert.doesNotMatch(page,/Sci-Fi Movie<\/b>/);
 assert.match(page,/id="libraryCollection"/);
});
test('add-on catalog diagnostics and filters are visible under Luma branding',async()=>{
 const x=addonHarness();x.run('LumaAddons.render()');x.node('#addonBrowse').onclick();await flush();
 const html=x.node('#content').innerHTML;
 assert.match(html,/id="addonCatalog"/);
 assert.match(html,/id="addonRemoteGenre"/);
 assert.match(html,/Source diagnostics/);
 assert.match(html,/LUMA ADD-ONS/);
 assert.doesNotMatch(html,/Stremio Add-ons|STREMIO ADD-ONS|Stremio manifests/);
});


test('original language is accurately shown on TMDB, TVMaze, and unavailable cards',()=>{
 const x=appHarness();
 const french=x.run("normalizeTMDB({id:44,media_type:'movie',title:'Foreign Film',release_date:'2025-05-01',original_language:'fr'})");
 assert.equal(french.original_language,'fr');
 assert.match(x.run("itemHTML(normalizeTMDB({id:44,media_type:'movie',title:'Foreign Film',original_language:'fr'}))"),/Original language: French/);
 assert.match(x.run("itemHTML(normalizeTVMaze({id:45,name:'International Show',language:'Japanese'}))"),/Original language: Japanese/);
 assert.match(x.run("itemHTML({id:'no-lang',title:'Unknown Film',type:'Movie',source:'itunes'})"),/Original language: Not listed/);
 assert.equal(x.run("originalLanguageName({original_language:'zh'})"),'Chinese');
 assert.match(x.run("itemHTML({id:'unsafe',title:'Safe',type:'Movie',original_language:'<img src=x onerror=alert(1)>'})"),/&lt;img/);
});
test('served standalone bundle includes original-language labels across all title-card variants',()=>{
 assert.ok(html.includes('function originalLanguageBadge(x)'));
 assert.ok(html.includes('Original language (optional)'));
 assert.ok(html.includes('originalLanguageBadge(f)'));
 assert.ok(html.includes('cardOriginalLanguage'));
});
