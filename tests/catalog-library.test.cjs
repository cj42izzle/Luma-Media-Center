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
  LumaAccounts:{settingsMarkup:()=>'',bindSettings(){},deviceItems:()=>JSON.parse(storage.getItem('luma.v2.watch')||'[]').map(id=>JSON.parse(storage.getItem('luma.device.titles.v1')||'{}')[id]).filter(Boolean),watchlistMarkup:()=>'',watchlistBind(){}},
  fetch:async(url)=>({ok:true,json:async()=>url.includes('tvmaze')?[]:{feed:{entry:[]}}}),
  AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console,scrollTo(){}};
 vm.createContext(ctx);
 vm.runInContext(appSource,ctx);
 return {ctx,node,storage,run:(js)=>vm.runInContext(js,ctx)};
}
function addonHarness(catalogIds){
 const manifest={id:'test.metadata',name:'Fixture Catalog',version:'1.0.0',types:['movie','series'],resources:['catalog','meta'],catalogs:[{type:'movie',id:'top',name:'Top',extra:[{name:'search'},{name:'skip'}]}]};
 if(catalogIds)manifest.catalogs=catalogIds.map(id=>({type:'movie',id,name:id}));
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

test('Movies, TV Shows and Anime expose full paginated libraries beyond the home shelf',()=>{
 const x=appHarness();
 x.run("state.items=[...Array.from({length:75},(_,i)=>({id:'movie-'+i,title:'Movie '+i,type:'Movie',source:'tmdb'})),...Array.from({length:63},(_,i)=>({id:'show-'+i,title:'Show '+i,type:'Series',source:'tvmaze'})),...Array.from({length:37},(_,i)=>({id:'anime-'+i,title:'Anime '+i,type:'Anime',source:'tmdb'}))];state.tab='Movies';render()");
 assert.match(x.node('#content').innerHTML,/Explore the movie library/);
 assert.match(x.node('#content').innerHTML,/Page 1 of 3/);
 assert.doesNotMatch(x.node('#content').innerHTML,/Show 20/);
 x.run("mediaBrowse.page=2;render()");
 assert.match(x.node('#content').innerHTML,/Movie 70/);
 x.run("state.tab='TV Shows';mediaBrowse.page=3;render()");
 assert.match(x.node('#content').innerHTML,/Explore the TV series library/);
 assert.match(x.node('#content').innerHTML,/Page 4 of 4/);
 assert.match(x.node('#content').innerHTML,/Anime 35/);
 x.run("state.tab='Anime';mediaBrowse.page=0;render()");
 assert.match(x.node('#content').innerHTML,/Explore anime &amp; animation/);
 assert.match(x.node('#content').innerHTML,/Page 1 of 2/);
 assert.doesNotMatch(x.node('#content').innerHTML,/Movie 12/);
});
test('free catalog seeds three full TVMaze pages and a larger movie feed',async()=>{
 const x=appHarness(),calls=[];
 x.ctx.api=async(url)=>{
  calls.push(url);
  if(url.includes('tvmaze.com/shows'))return Array.from({length:4},(_,i)=>{
   const page=Number(new URL(url).searchParams.get('page'));
   return {id:page*250+i+1,name:'Show '+page+' '+i,image:{medium:'https://example.test/show.jpg'},genres:['Drama']};
  });
  if(url.includes('schedule?')||url.includes('schedule/web?'))return [{show:{
   id:url.includes('schedule/web?')?10002:10001,name:'Newly Airing',image:{medium:'https://example.test/new.jpg'},genres:['Drama']
  }}];
  if(url.includes('itunes.apple.com'))return {feed:{entry:Array.from({length:60},(_,i)=>({
   id:{attributes:{'im:id':'film-'+i}},'im:name':{label:'Film '+i},'im:image':[{label:'https://example.test/movie.jpg'}]
  }))}};
  throw new Error('Unexpected metadata URL '+url);
 };
 const result=await x.run('freeCatalogSeed()');
 assert.equal(result.length,74);
 assert.equal(x.run('tvmazeMorePage'),3);
 assert.equal(calls.filter(url=>url.includes('/shows?page=')).length,3);
 assert.equal(calls.filter(url=>url.includes('/schedule')).length,2);
 assert.ok(calls.some(url=>url.includes('/limit=200/json')));
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
test('early titles are usable while slow catalogs load and free slots pick up queued feeds',async()=>{
 const ids=Array.from({length:8},(_,i)=>'catalog'+i),x=addonHarness(ids);
 const finish=new Map(),started=[];
 x.ctx.fetch=url=>new Promise(resolve=>{
  const id=new URL(url).pathname.split('/').pop().split('.')[0];
  started.push(id);
  finish.set(id,()=>resolve({ok:true,text:async()=>JSON.stringify({metas:[{id,name:id,type:'movie'}]})}));
 });
 x.run('LumaAddons.render()');x.node('#addonBrowse').onclick();
 assert.equal(started.length,6);
 finish.get(ids[3])();await flush();
 assert.match(x.node('#content').innerHTML,/data-addon-open="addon:test.metadata:movie:catalog3"/);
 assert.equal(started.length,7);
 finish.get(ids[6])();await flush();
 assert.equal(started.length,8);
 for(const id of ids)finish.get(id)();
 await flush();
 assert.match(x.node('#content').innerHTML,/8 loaded/);
 const order=[...x.node('#content').innerHTML.matchAll(/data-addon-open="addon:test.metadata:movie:(catalog\d)"/g)].map(m=>m[1]);
 assert.deepEqual(order,ids);
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
 assert.ok(html.includes('languageBadges(f)'));
 assert.ok(html.includes('cardOriginalLanguage'));
});


test('Wikidata language resolution checks the film year, not only the title',async()=>{
 const x=appHarness();
 x.run('api=async function(url){const u=new URL(url);if(u.searchParams.get("action")==="wbsearchentities")return {search:[{id:"Q1"}]};if(u.searchParams.get("ids")==="Q1860")return {entities:{Q1860:{labels:{en:{value:"English"}}}}};return {entities:{Q1:{labels:{en:{value:"The Odyssey"}},descriptions:{en:{value:"2026 film"}},claims:{P31:[{mainsnak:{datavalue:{value:{id:"Q11424"}}}}],P364:[{mainsnak:{datavalue:{value:{id:"Q1860"}}}}]}}}}}');
 assert.equal(await x.run('findOriginalLanguage({id:"apple:1",title:"The Odyssey (2026)",year:"2026",type:"Movie"})'),"English");
 assert.equal(await x.run('findOriginalLanguage({id:"apple:1",title:"The Odyssey (2025)",year:"2025",type:"Movie"})'),"");
});
test('an English dub requires a matching anime with English voice cast data',async()=>{
 const x=appHarness();
 x.run('api=async function(url){if(url.includes("/anime?"))return {data:[{mal_id:20,title:"Naruto",aired:{from:"2002-10-03"}}]};if(url.includes("/characters"))return {data:[{voice_actors:[{language:"Japanese"},{language:"English"}]}]};return {}}');
 assert.equal(await x.run('findAnimeEnglishDub({id:"a",title:"Naruto",year:"2002",type:"Anime",original_language:"ja"})'),true);
 assert.match(x.run('englishDubBadge({id:"a",title:"Naruto",year:"2002",type:"Anime",original_language:"ja",englishDub:true})'),/English Dub/);
 assert.equal(x.run('englishDubBadge({id:"b",title:"English Original",type:"Movie",original_language:"en",englishDub:true})'),"");
 x.run('api=async function(url){if(url.includes("/anime?"))return {data:[{mal_id:20,title:"Naruto",aired:{from:"2002-10-03"}}]};if(url.includes("/characters"))return {data:[{voice_actors:[{language:"Japanese"}]}]};return {}}');
 assert.equal(await x.run('findAnimeEnglishDub({id:"a",title:"Naruto",year:"2002",type:"Anime",original_language:"ja"})'),false);
});
test('resolved original language survives source metadata gaps and appears on all cards',()=>{
 const x=appHarness();
 x.run('recordLanguage({id:"applechart:101",title:"Example",year:"2026"},{original_language:"Japanese",updated:Date.now()})');
 assert.match(x.run('itemHTML({id:"applechart:101",title:"Example",type:"Movie",year:"2026",source:"applechart"})'),/Original language: Japanese/);
 assert.ok(x.storage.getItem('luma.v2.languageLookupV1'));
 assert.match(html,/function scanLanguageCards\(\)/);
});

test('Wikidata lookup finds a matching modern film even after 20 similarly named results',async()=>{
 const x=appHarness();
 x.run('api=async function(url){const u=new URL(url);if(u.searchParams.get("action")==="wbsearchentities"){const hits=Array.from({length:21},(_,i)=>({id:"Q"+(100+i),description:"1990 movie"}));return {search:[...hits,{id:"Q2026",description:"2026 film directed by Someone"}]}};if(u.searchParams.get("ids")==="Q1860")return {entities:{Q1860:{labels:{en:{value:"English"}}}}};return {entities:{Q2026:{labels:{en:{value:"The Odyssey"}},descriptions:{en:{value:"2026 film directed by Someone"}},claims:{P31:[{mainsnak:{datavalue:{value:{id:"Q11424"}}}}],P364:[{mainsnak:{datavalue:{value:{id:"Q1860"}}}}]}}}}}');
 assert.equal(await x.run('findOriginalLanguage({id:"applechart:2026",title:"The Odyssey (2026)",year:"2026",type:"Movie"})'),"English");
});

test('card-language switches hide each badge independently',()=>{
 const x=appHarness(),title='{id:"anime:11",title:"Dubbed Anime",year:"2026",type:"Anime",original_language:"ja",englishDub:true}';
 assert.match(x.run('languageBadges('+title+')'),/Original language: Japanese/);
 assert.match(x.run('languageBadges('+title+')'),/English Dub/);
 x.run('state.showOriginalLanguage=false');
 assert.doesNotMatch(x.run('languageBadges('+title+')'),/cardOriginalLanguage/);
 assert.match(x.run('languageBadges('+title+')'),/English Dub/);
 x.run('state.showEnglishDub=false');
 assert.equal(x.run('languageBadges('+title+')'),"");
 x.run('state.showOriginalLanguage=true');
 assert.match(x.run('languageBadges('+title+')'),/Original language: Japanese/);
 assert.doesNotMatch(x.run('languageBadges('+title+')'),/English Dub/);
});
test('settings expose persistent original-language and English dub choices',()=>{
 const x=appHarness();x.run('state.tab="Settings";settings()');
 assert.match(x.node('#content').innerHTML,/toggleOriginalLanguage/);
 assert.match(x.node('#content').innerHTML,/toggleEnglishDub/);
 x.node('#toggleOriginalLanguage').onchange({target:{checked:false}});
 x.node('#toggleEnglishDub').onchange({target:{checked:false}});
 assert.equal(x.storage.getItem('luma.v2.showOriginalLanguage'),"false");
 assert.equal(x.storage.getItem('luma.v2.showEnglishDub'),"false");
 assert.match(html,/document.documentElement.dataset.tv/);
});

test('new Luma app branding is available to both browser and TV packages',()=>{
 const logo=fs.readFileSync('luma-logo.svg','utf8');
 assert.match(logo,/<svg/);assert.match(logo,/aria-label="Luma Media Center"/);
 assert.match(html,/rel="apple-touch-icon" sizes="180x180" href="\.\/apple-touch-icon\.png"/);assert.ok(fs.existsSync("apple-touch-icon.png"));
});

test('movie age certifications use the correct country and release classification',()=>{
 const x=appHarness();
 const f={results:[{iso_3166_1:"US",release_dates:[{type:4,certification:"PG-13"},{type:3,certification:"R"}]},{iso_3166_1:"GB",release_dates:[{type:3,certification:"15"}]}]};
 x.run("var t="+JSON.stringify(f));
 assert.equal(x.run('tmdbCertificate(t,false,"US")'),"R");
 assert.equal(x.run('tmdbCertificate(t,false,"GB")'),"15");
 assert.equal(x.run('tmdbCertificate({results:[{iso_3166_1:"US",rating:"TV-MA"}]},true,"US")'),"TV-MA");
 assert.equal(x.run('tmdbCertificate({results:[]},false,"US")'),"");
});
test('movie and show cards expose supplied ratings without making up unknown classifications',()=>{
 const x=appHarness();
 const film=x.run('itemHTML({id:"film",title:"Film",type:"Movie",rating:7.8,contentRating:"R"})');
 assert.match(film,/★ 7.8\/10/);assert.match(film,/Rated R/);
 const unknown=x.run('itemHTML({id:"unknown",title:"Unknown",type:"Movie"})');
 assert.doesNotMatch(unknown,/★ [0-9]/);
 assert.doesNotMatch(unknown,/Rated R/);
 assert.match(unknown,/certificateSlot/);
});

test('served add-on and filmography cards include both provider scores and classifications',()=>{
 assert.match(html,/typeof audienceBadge==="function"/);
 assert.match(html,/typeof certificateSlot==="function"/);
 assert.match(html,/detailContentRating/);
});

test('latest aired episode shows S/E/date and clears only when the exact episode is watched',()=>{
 const x=appHarness();
 x.run('saveLastAired({id:"tvmaze:123",type:"Series",title:"Show"},{season:2,number:5,airdate:"2025-11-15"})');
 const card=x.run('itemHTML({id:"tvmaze:123",title:"Show",type:"Series",year:"2020",source:"tvmaze"})');
 assert.match(card,/S02E05/);assert.match(card,/LAST AIRED/);assert.match(card,/cardYear/);assert.match(card,/cardMediaType/);
 x.run('state.watched.push("tvmaze:123:s2e5")');
 assert.doesNotMatch(x.run('itemHTML({id:"tvmaze:123",title:"Show",type:"Series",source:"tvmaze"})'),/LAST AIRED/);
 assert.doesNotMatch(x.run('itemHTML({id:"movie",title:"Film",type:"Movie"})'),/lastAiredSlot/);
});
test('future episodes and specials are excluded from aired status',()=>{
 const x=appHarness();
 assert.equal(x.run('normalizeLastAired({season:0,number:2,airdate:"2025-01-01"})'),null);
 assert.equal(x.run('normalizeLastAired({season:1,number:0,airdate:"2025-01-01"})'),null);
 assert.equal(x.run('normalizeLastAired({season:1,number:2,airdate:"2099-01-01"})'),null);
});

test('Luma Live TV routes to the integrated IPTV guide',()=>{
 const x=appHarness();
 x.run('state.tab="Live TV";var LumaIPTV={render:()=>{$("#content").innerHTML="Live TV Guide"}};render()');
 assert.match(x.node('#content').innerHTML,/Live TV Guide/);
 assert.match(html,/\["Live TV","▣"\]/);
 assert.match(html,/const LumaIPTV=/);
});


test('cinematic TV-first layout keeps primary destinations and collapses advanced destinations',()=>{
 assert.match(appSource,/const quick=new Set\(\["Home","Live TV","Guide","Recordings","Movies","TV Shows","Anime","Watchlist","My Library"\]\)/);
 assert.match(appSource,/lumaNavMore/);
 assert.match(appSource,/id="lumaNavSearch"/);
 assert.match(appSource,/name==="Add-ons"\?"Luma Add-ons"/);
 assert.match(html,/href="\.\/theater\.css(?:\?v=[^"]+)?"/);
 const css=fs.readFileSync('theater.css','utf8');
 for(const selector of ['.hero.heroCinematic','.lumaMediaCard','.iptvGuideSpotlight','.iptvGuideCategories','.iptvProgramWrap','.iptvProgramRecord','.iptvDvrTabs','.iptvPortalHero','.lumaNavMore'])
  assert.ok(css.includes(selector),"Missing theater layout: "+selector);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css, /prefers-reduced-motion/);
});

test("all visible Home dashboard and cinematic quick-navigation controls have a real click handler",()=>{
 assert.match(appSource,/event\.target\.closest\?\.\("\[data-go\]"\)/);
 assert.match(appSource,/state\.tab=next/);
 assert.match(appSource,/available\.includes\(next\)/);
 assert.match(html,/LumaHome\.markup/);
});

test('catalog caches are compact and do not consume space needed for saved history',()=>{
 const x=appHarness();
 const long=Array.from({length:700},(_,i)=>({id:'movie'+i,title:'Film '+i,type:'Movie',poster:'https://example.test/poster',overview:'A'.repeat(5000),source:'tmdb'}));
 x.run('save("catalog",'+JSON.stringify(long)+')');
 const cache=JSON.parse(x.storage.getItem('luma.v2.catalog'));
 assert.equal(cache.length,360);
 assert.equal(cache[0].overview,undefined);
 assert.ok(x.storage.getItem('luma.device.titles.v1').includes('Cached television series'));
});
test('quota recovery evicts disposable caches, not viewer records',()=>{
 const x=appHarness();
 x.storage.setItem('luma.v2.catalog','temporary catalog cache');
 const base=x.storage.setItem.bind(x.storage);
 let reject=true;
 x.storage.setItem=(key,v)=>{
  if(key==='luma.v2.watch'&&reject){reject=false;const error=Error('storage full');error.name='QuotaExceededError';throw error}
  return base(key,v);
 };
 x.run("state.items=[{id:'safe-film',title:'Safe film',type:'Movie'}];toggleWatch('safe-film')");
 assert.ok(x.storage.getItem('luma.v2.watch').includes('safe-film'));
 assert.equal(x.storage.getItem('luma.v2.catalog'),null);
 assert.ok(x.storage.getItem('luma.device.titles.v1').includes('Cached television series'));
});
test('unknown saved IDs remain represented without invented title or type',()=>{
 const x=appHarness();
 x.storage.setItem('luma.v2.watch',JSON.stringify(['mystery:abc']));
 x.run("state.watch=['mystery:abc'];state.tab='My Library';render()");
 // Production LumaAccounts.deviceItems() identifies unresolved IDs; the
 // library itself must render a recovery action without dropping the ID.
 x.run("state.items=[{id:'mystery:abc',title:'Metadata unavailable',type:'Unknown',unresolved:true}];render()");
 assert.match(x.node('#content').innerHTML,/Metadata unavailable/);
 assert.match(x.node('#content').innerHTML,/mystery:abc/);
});

test('verified external IDs collapse duplicate cards without deleting saved IDs',()=>{
 const x=appHarness();
 const value=x.run('uniqueMediaCards([{id:"tmdb:tv:14",title:"Example Show",type:"Series",imdbId:"tt1234567",year:"2024"},{id:"cinemeta:tt1234567",title:"Example Show",type:"Series",imdbId:"tt1234567",poster:"https://example.test/poster"},{id:"tmdb:tv:15",title:"Example Show",type:"Series",imdbId:"tt7654321",year:"2024"}])');
 assert.equal(value.length,2,'Only identical verified external identities can merge');
 assert.equal(value[0].id,'tmdb:tv:14','Keep the first saved record ID');
 assert.equal(value[0].poster,'https://example.test/poster');
 assert.equal(value[1].id,'tmdb:tv:15','Unrelated shows with the same title and year stay separate');
});
test('progress points to the most recently unfinished series episode',()=>{
 const x=appHarness();
 const v=x.run('state.progress={"series:s1e1":{fraction:1,seconds:1400,updated:1},"series:s2e3":{fraction:.5,seconds:870,updated:90},"series:s2e2":{fraction:.4,seconds:520,updated:5}};state.watched=["series:s1e1"];progressForTitle({id:"series",type:"Series",title:"Show"})');
 assert.equal(v.season,2);assert.equal(v.episode,3);assert.equal(v.seconds,870);
 assert.equal(v.label,'S2E3');
});
test('system health is navigable and describes storage recovery without clearing user data',()=>{
 const x=appHarness();
 x.run('state.tab="System Health";render()');
 const body=x.node('#content').innerHTML;
 for(const name of ['System Health','Run health check','Request protected storage','Download Library backup','Retry missing metadata'])
  assert.ok(body.includes(name),name);
 assert.equal(x.run('LumaDurable.diagnostic().available'),false);
 assert.match(appSource,/indexedDB\.open\("luma-library-records",1\)/);
 assert.match(appSource,/clearDisposableCaches/);
});
test('backup validation and staging guard against an incomplete restore',()=>{
 const x=appHarness();
 const watchBefore=x.storage.getItem('luma.v2.watch');
 const backup=x.run('cleanBackup({watch:["new-title"],favorites:[],watched:["watched-new"],library:[],watchDetails:{}})');
 const original=x.storage.setItem.bind(x.storage);
 x.storage.setItem=(key,value)=>{
  if(key==='luma.v2.watched')throw Error('Storage quota exceeded');
  original(key,value);
 };
 const ok=x.ctx.applyBackup(backup,false);
 assert.equal(ok,false);
 assert.equal(x.storage.getItem('luma.v2.watch'),watchBefore);
 assert.equal(x.run('state.watch.includes("new-title")'),false);
});

test("compact Home cards preserve exact saved status and display shared title metadata",()=>{
 const h=appHarness();
 const item={id:"tvmaze:83",title:"A Complete Show",type:"Series",source:"tvmaze",year:"2017",
   poster:"https://example.test/poster.jpg",rating:7.6,original_language:"ja",englishDub:true,genreNames:["Drama","Action"]};
 h.ctx.fixtureItem=item;
 h.run('state.tab="Home";state.watch=["tvmaze:83"];state.items=[fixtureItem]');
 const compact=h.run("homeMediaCardHTML(fixtureItem)");
 assert.match(compact,/class="media lumaMediaCard lumaHomeMediaCard"/);
 assert.match(compact,/homeCardMeta/);
 assert.match(compact,/aria-label="In watchlist">✓/);
 assert.match(compact,/A Complete Show/);
 assert.match(compact,/★ 7.6/);
 for(const value of ["cardGenres","Original language: Japanese","English Dub","certificateSlot","Drama · Action"])assert.ok(compact.includes(value),value);
 const full=h.run("itemHTML(fixtureItem)");
 assert.match(full,/cardGenres/);
 const row=h.run('shelf("Your Watchlist",[fixtureItem],"Saved for later","Watchlist")');
 assert.match(row,/lumaCompactShelf/);
 assert.match(row,/lumaHomeMediaCard/);
 assert.match(row,/See all/);
 assert.doesNotMatch(row,/Explore collection ›/);
});
test("poster actions support both existing and newly added Watchlist/Favorites records",()=>{
 const h=appHarness();
 h.run('state.items=[{id:"film:8",title:"Favorite Film",type:"Movie",year:"2024",poster:"https://example.test/p.jpg"}];'
  +'var poster={dataset:{open:"film:8"},closest:function(sel){return sel.startsWith("button.media")?this:null}};');
 assert.equal(h.run('posterActionTarget(poster)===poster'),true);
 assert.equal(h.run('openPosterActions(poster)'),true);
 assert.match(h.node("#modal").innerHTML,/Add to Watchlist/);
 assert.match(h.node("#modal").innerHTML,/Add to Favorites/);
 assert.match(h.node("#modal").innerHTML,/View details/);
 assert.equal(typeof h.node("#posterActionWatch").onclick,"function");
 h.node("#posterActionWatch").onclick();
 assert.deepEqual(JSON.parse(h.storage.getItem('luma.v2.watch')),["saved-1","film:8"]);
 assert.equal(h.run('openPosterActions(poster)'),true);
 assert.match(h.node("#modal").innerHTML,/Remove from Watchlist/);
 h.node("#posterActionFavorite").onclick();
 assert.deepEqual(JSON.parse(h.storage.getItem('luma.v2.favorites')),["film:8"]);
 assert.equal(h.run('openPosterActions(poster)'),true);
 assert.match(h.node("#modal").innerHTML,/Remove from Favorites/);
 h.node("#posterActionWatch").onclick();
 assert.deepEqual(JSON.parse(h.storage.getItem('luma.v2.watch')),["saved-1"]);
 assert.deepEqual(JSON.parse(h.storage.getItem('luma.v2.favorites')),["film:8"]);
});
test("poster hold does not steal scroll; desktop right-click and keyboard menu are available",()=>{
 const app=fs.readFileSync("app.js","utf8"),style=fs.readFileSync("theater.css","utf8");
 assert.match(app,/pointerdown/);
 assert.match(app,/pointermove/);
 assert.match(app,/Math\.hypot/);
 assert.match(app,/setTimeout\(\(\)=>\{/);
 assert.match(app,/contextmenu/);
 assert.match(app,/e\.key==="ContextMenu"/);
 assert.match(app,/posterSuppressedUntil/);
 assert.match(app,/stopImmediatePropagation/);
 assert.match(style,/-webkit-touch-callout:none/);
 assert.match(style,/#modal:has\(\.lumaPosterActionSheet\)/);
 assert.match(style,/lumaPosterActionCancel/);
});

test("language badges recover a previously cached miss using the exact series ID",async()=>{
 const h=appHarness();
 h.run('state.showEnglishDub=false;globalThis.show={id:"cinemeta:tt5753856",type:"Series",title:"Dark",original_language:"und"};recordLanguage(show,{original_language:"",langChecked:Date.now()});api=async url=>{if(url!=="https://api.tvmaze.com/lookup/shows?imdb=tt5753856")throw Error(url);return {language:"German"}}');
 await h.run("hydrateLanguage(show)");
 assert.match(h.run("homeMediaCardHTML(show)"),/Original language: German/);
});
test("movie language uses the IMDb-linked original-language claim without a release year",async()=>{
 const h=appHarness();
 h.run('api=async url=>{const q=new URL(url).searchParams.get("query");if(!q?.includes("tt6751668")||!q.includes("P364"))throw Error(url);return {results:{bindings:[{languageLabel:{value:"Korean"}}]}}}');
 assert.equal(await h.run('findOriginalLanguage({id:"cinemeta:tt6751668",type:"Movie",title:"Parasite"})'),"Korean");
});
