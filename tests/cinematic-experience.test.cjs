'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const appSource=fs.readFileSync('app.js','utf8');
const addonSource=fs.readFileSync('addons.js','utf8');
const html=fs.readFileSync('index.html','utf8');
function appHarness(){
 const stored=new Map(),elements=new Map();
 const node=selector=>{
  if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:'',scrollTop:0,style:{setProperty(){}},dataset:{},
   classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelector(){return null},focus(){},click(){}});
  return elements.get(selector);
 };
 const document={querySelector:node,querySelectorAll:()=>[],documentElement:{style:{setProperty(){}},dataset:{}},body:{classList:{add(){},remove(){}}},
  addEventListener(){}};
 const localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
 const ctx={document,localStorage,window:{addEventListener(){}},navigator:{},location:{origin:'https://example.test',pathname:'/luma/'},
  LumaReleases:{all:()=>[],label:()=>'',refresh:async()=>{},homepage:()=>'',releasePage:()=>'',bind(){},enrichDetail(){}},
  LumaCalendar:{prime:async()=>{},homeMarkup:()=>'',bindHome(){},registerFollow(){}},
  LumaAddons:{render(){},installed:()=>1,lookupTitle(x,id,ep){ctx.selectedEpisode=ep}},
  LumaCollections:{collectionID:(title,page)=>page==="TV Shows"?"series":page==="Movies"?"movies":"discover",providerShowcase:()=>"",renderCollection:()=>"",bind(){},find:()=>null,open(){}},
  LumaPeople:{markup:()=>'',bind(){}},LumaAccounts:{deviceItems:()=>[],watchlistMarkup:()=>'',watchlistBind(){}},
  fetch:async url=>({ok:true,json:async()=>url.includes('tvmaze')?[]:{feed:{entry:[]}}}),
  AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console,scrollTo(){}};
 vm.createContext(ctx);vm.runInContext(appSource,ctx);
 return {ctx,node,run:code=>vm.runInContext(code,ctx)};
}
function addonHarness(){
 const stored=new Map(),elements=new Map();
 const node=selector=>{
  if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',scrollTop:0,value:'',dataset:{},classList:{add(){},remove(){}},
   querySelector(){return null},style:{},addEventListener(){}});
  return elements.get(selector);
 };
 const localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v))};
 const document={querySelector:node,querySelectorAll:()=>[]};
 const ctx={$:node,$$:()=>[],state:{tab:'Add-ons',progress:{}},document,localStorage,toast(){},safe:String,modal:value=>{node('#modal').innerHTML=value},render(){},closeModal(){},
  fetch:async()=>({ok:true,text:async()=>'{"metas":[]}'}),AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console};
 const before='return {open,render,attachPlayerButtons,lookupTitle,installed:()=>list.length};';
 assert.ok(addonSource.includes(before),'Unexpected add-on export shape');
 const instrumented=addonSource.replace(before,
   'return {open,render,attachPlayerButtons,lookupTitle,installed:()=>list.length,_test:{validateManifest,endpoint,cleanStreamResults,streamInfo,subtitleURL,prepareProviders:(providers)=>{list=providers;detail={title:"Release",stremioID:"tt1234567",stremioType:"movie"}},getStreams,setQuery:q=>{streamQuery=q;showStreams("")},setFilters:(choices,sort)=>{streamChoices=choices;streamSort=sort;streamPage=0;showStreams("")},renderStreams:(rows,failures)=>{streams=rows;streamFailures=failures;detail={title:"The Odyssey",poster:"https://images.example/poster.jpg",stremioID:"tt1234567"};showStreams("")}}};');
 vm.createContext(ctx);vm.runInContext(instrumented,ctx);
 return {run:code=>vm.runInContext(code,ctx),node};
}
test('served index is the current Luma build with real image hero and episode UI',()=>{
 assert.match(html,/Luma · Live Build 33/);
 assert.match(html,/class="heroVisual"/);
 assert.match(html,/class="episode episodeCinematic"/);
 assert.match(html,/streamWarnings/);
 assert.match(html,/\/\* Luma cinematic experience v30/);
});
test('home feature renders a real image and more varied media rows',()=>{
 const x=appHarness();
 const page=x.run('hero([{id:"movie",usReleaseDate:airDay(),title:"A Beautiful Story",type:"Movie",year:"2026",poster:"https://images.example/poster.jpg",overview:"A grand adventure",genreNames:["Drama"]}])');
 assert.match(page,/class="heroVisual"/);assert.match(page,/src="https:\/\/images\.example\/poster\.jpg"/);
 assert.match(page,/data-hero-shift="1"/);
 const rows=x.run('homeDiscoveryRows([{id:"film",title:"A Movie",type:"Movie",poster:"https://images.example/film.jpg",year:"2025"},{id:"show",title:"A Series",type:"Series",poster:"https://images.example/show.jpg",year:"2024"}])');
 assert.match(rows,/TV series to explore/);assert.match(rows,/Movies for tonight/);assert.match(rows,/lumaMediaCard/);
});
test('TV season one loads automatically and individual episodes appear',async()=>{
 const x=appHarness();
 x.run('state.items=[{id:"tmdb:tv:777",title:"The Odyssey",type:"Series",tmdbId:777,source:"tmdb",poster:"https://images.example/odyssey.jpg"}];state.tmdbKey="test";tmdbCalls=[];tmdb=async function(path){tmdbCalls.push(path);if(path==="tv/777")return {id:777,seasons:[{season_number:1,name:"Season 1"},{season_number:2,name:"Season 2"}]};if(path==="tv/777/season/1")return {episodes:[{id:1,season_number:1,episode_number:1,name:"Pilot",overview:"Chapter one",air_date:"2026-11-01",still_path:"/pilot.jpg",runtime:44},{id:2,season_number:1,episode_number:2,name:"The Crossing",overview:"Chapter two",air_date:"2026-11-08",runtime:49}]};if(path==="tv/777/season/2")return {episodes:[{id:3,season_number:2,episode_number:1,name:"New Horizons",runtime:51}]};return {}}');
 await x.run('openTitle("tmdb:tv:777")');
 const page=x.node('#modal').innerHTML;
 assert.ok(x.run('tmdbCalls.includes("tv/777/season/1")'),'Season 1 not automatically fetched');
 assert.match(page,/Seasons & episodes/);assert.match(page,/Pilot/);assert.match(page,/The Crossing/);
 assert.match(page,/class="episodeStill"/);assert.match(page,/class="episode episodeCinematic"/);assert.match(page,/S01E01/);
 await x.node('#seasonSelect').onchange({target:{value:'2'}});
 assert.ok(x.run('tmdbCalls.includes("tv/777/season/2")'));
 assert.match(x.node('#modal').innerHTML,/New Horizons/);
});
test('TVmaze titles load multi-season episodes and real thumbnails',async()=>{
 const x=appHarness();
 x.run('state.items=[{id:"tvmaze:88",title:"Example Series",type:"Series",mazeId:88,source:"tvmaze"}];api=async function(url){if(url.includes("/episodes"))return [{id:1,season:1,number:1,name:"First",image:{medium:"https://images.example/first.jpg"},airdate:"2025-01-01"},{id:2,season:2,number:1,name:"Second",image:{medium:"https://images.example/second.jpg"},airdate:"2026-01-01"}];return []}');
 await x.run('openTitle("tvmaze:88")');
 assert.match(x.node('#modal').innerHTML,/First/);
 assert.match(x.node('#modal').innerHTML,/Season 2/);
 assert.match(x.node('#modal').innerHTML,/images\.example\/first\.jpg/);
 await x.node('#seasonSelect').onchange({target:{value:'2'}});
 assert.match(x.node('#modal').innerHTML,/Second/);
});
test('stream-only manifest is valid and configuration survives URL generation',()=>{
 const x=addonHarness();
 const result=x.run('LumaAddons._test.validateManifest({id:"stream.fixture",name:"Stream Fixture",types:["movie","series"],resources:["stream"],version:"1.0.0"})');
 assert.deepEqual([...result.catalogs],[]);assert.deepEqual([...result.types],['movie','series']);
 const url=x.run('LumaAddons._test.endpoint({url:"https://addon.example/configured/manifest.json?token=TEST",manifest:{}},"stream","series","tt1234567:1:2")');
 assert.match(url,/\/configured\/stream\/series\/tt1234567%3A1%3A2\.json/);
 assert.match(url,/\?token=TEST$/);
});
test('failed add-ons do not hide or duplicate working playback links',()=>{
 const x=addonHarness();
 x.run('LumaAddons._test.renderStreams([{provider:"Provider A",raw:{name:"4K HDR remux",title:"4K HDR remux",url:"https://stream.example/first.mp4"}},{provider:"Provider A",raw:{name:"4K HDR remux",title:"4K HDR remux",url:"https://stream.example/first.mp4"}},{provider:"Provider B",raw:{name:"1080p video",title:"1080p video",url:"https://stream.example/second.mp4"}}],[{provider:"Provider C",reason:"HTTP 503"}])');
 const page=x.node('#modal').innerHTML;
 assert.match(page,/2 sources/);assert.match(page,/2 direct links/);
 assert.match(page,/streamWarnings/);assert.match(page,/Provider C/);
 assert.match(page,/data-source="0"/);assert.match(page,/data-source="2"/);
 assert.match(page,/id="streamProvider"/);assert.match(page,/Choose player/);
});

test("hero features saved unfinished media before unrelated discovery, without faking a stream",()=>{
 const x=appHarness();
 x.run('state.progress={"resume-show:s2e3":{fraction:.45,seconds:920,updated:100}}');
 x.ctx.heroModel={watching:[{id:"resume-show",usReleaseDate:x.run("airDay()"),title:"Continue Me",type:"Series",poster:"https://images.example/resume.jpg",overview:"A continuing story"}],
  watchlist:[{id:"saved",title:"Saved for later",type:"Movie",poster:"https://images.example/saved.jpg"}],
  items:[{id:"unrelated",title:"Unrelated",type:"Movie",poster:"https://images.example/other.jpg"}]};
 const markup=x.run("hero(heroModel)");
 assert.match(markup,/Continue Me/);
 assert.doesNotMatch(markup,/FEATURED FOR YOU/);
 assert.match(markup,/data-home-resume="resume-show"/);
 assert.match(markup,/S2E3/);
 assert.match(markup,/45% watched/);
 assert.match(markup,/U.S. series premiere/);
 assert.match(appSource,/function openHomeResume\(id\)/);
 assert.match(appSource,/chooseLink\(state\.selected,exact\)/);
});
test("the rebuilt Home passes actual watch progress and followed episode dates to all displays",()=>{
 assert.match(appSource,/watchingProgress:homeLibrary\.watching\.map/);
 assert.match(appSource,/followedRows:typeof LumaCalendar/);
 assert.match(appSource,/hero\(homepageModel\)/);
 assert.match(appSource,/data-home-resume/);
 assert.match(appSource,/data-home-play/);
});

test("closing an iPhone title restores the same vertical location and poster-rail offsets",()=>{
 const x=appHarness(),doc=x.ctx.document,win=x.ctx.window;
 const rails=[
  {scrollLeft:175,getAttribute:key=>key==="aria-label"?"Your Watchlist horizontal titles":null,closest:()=>null},
  {scrollLeft:80,getAttribute:key=>key==="aria-label"?"Your Favorites horizontal titles":null,closest:()=>null}
 ];
 const originalQuery=doc.querySelector.bind(doc),originalAll=doc.querySelectorAll.bind(doc);
 doc.querySelector=selector=>selector==="#video"?null:originalQuery(selector);
 doc.querySelectorAll=selector=>selector.startsWith("#content .tiles")?rails:originalAll(selector);
 doc.scrollingElement={scrollTop:740};win.scrollY=740;
 win.scrollTo=(xPosition,yPosition)=>{win.scrollY=yPosition;doc.scrollingElement.scrollTop=yPosition};
 x.run('state.tab="Home";modal("<p>Episode details</p>")');
 win.scrollY=0;doc.scrollingElement.scrollTop=0;
 rails[0].scrollLeft=0;rails[1].scrollLeft=0;
 x.run('closeModal()');
 assert.equal(win.scrollY,740);
 assert.equal(doc.scrollingElement.scrollTop,740);
 assert.deepEqual(rails.map(r=>r.scrollLeft),[175,80]);
});
test("restoring the browsing spot never incorrectly changes another page",()=>{
 const x=appHarness(),doc=x.ctx.document,win=x.ctx.window;
 const rail={scrollLeft:100,getAttribute:()=>null,closest:()=>null};
 doc.querySelectorAll=()=>[rail];doc.scrollingElement={scrollTop:300};
 win.scrollY=300;win.scrollTo=(left,top)=>{win.scrollY=top;doc.scrollingElement.scrollTop=top};
 const point=x.run('snapshotBrowsingLocation()');
 rail.scrollLeft=0;win.scrollY=0;doc.scrollingElement.scrollTop=0;
 x.run('state.tab="TV Shows"');
 x.ctx.savedPoint=point;
 x.run('restoreBrowsingLocation(savedPoint)');
 assert.equal(win.scrollY,0);assert.equal(rail.scrollLeft,0);
 x.run('state.tab="Home";restoreBrowsingLocation(savedPoint)');
 assert.equal(win.scrollY,300);assert.equal(rail.scrollLeft,100);
});

test('stream facets distinguish reported audio, subtitles, cache, service and seed count',()=>{
 const x=addonHarness();
 const release=x.run(`LumaAddons._test.streamInfo({provider:"Fixture",providerId:"fixture",
  raw:{name:"[TB+] Fixture provider",title:"Audio: en / ja\\nSubtitles: es",infoHash:"fixture",
   behaviorHints:{filename:"Fixture.2160p.Dual.Audio.WEB-DL.HDR10+.HEVC.Atmos.mkv",videoSize:7000000000},
   subtitles:[{lang:"fr"}],seeders:0}},0)`);
 assert.deepEqual([...release.fields.audio],['English','Japanese']);
 assert.deepEqual([...release.fields.subtitles],['French','Spanish']);
 for(const [key,value] of Object.entries({provider:'fixture',quality:'4K',size:'5–20 GB',debrid:'TorBox',cache:'Cached',
  availability:'No reported seeds',edition:'Dual audio',range:'HDR10+',codec:'HEVC',sound:'Atmos',release:'WEB-DL',delivery:'Torrent'}))
  assert.ok(release.fields[key].includes(value),key);
 const unknown=x.run('LumaAddons._test.streamInfo({provider:"F",raw:{title:"A French Summer",subtitles:[{lang:"ja"}],externalUrl:"https://external.example"}},0)');
 for(const key of ['audio','cache','size','quality','availability'])assert.deepEqual([...unknown.fields[key]],['Unspecified']);
 assert.equal(unknown.seeds,null);
 assert.deepEqual([...unknown.fields.delivery],['External link']);
});
test('provider, quality and release filters intersect without losing a shared link or its playback index',()=>{
 const x=addonHarness(),opts=x.node('#modal');
 const url='https://media.example/shared.mp4';
 const rows=[
  {provider:'Twin',providerId:'a',raw:{url,title:'Other release',name:'720p',seeders:25}},
  {provider:'Twin',providerId:'b',raw:{url,title:'Small release',name:'[RD+] 2160p 800 MB',seeders:0}},
  {provider:'Twin',providerId:'b',raw:{url,title:'Large release',name:'2160p 2 GiB'}},
  {provider:'Twin',providerId:'b',raw:{url,title:'Unspecified size',name:'1080p'}}
 ];
 x.run('LumaAddons._test.renderStreams('+JSON.stringify(rows)+',[])');
 assert.match(opts.innerHTML,/Twin · a/);assert.match(opts.innerHTML,/Twin · b/);
 const filtered=(choices,sort)=>{
  x.run('LumaAddons._test.setFilters('+JSON.stringify(choices)+','+JSON.stringify(sort)+')');
  return [...opts.innerHTML.matchAll(/data-source="(\d+)"/g)].map(m=>Number(m[1]));
 };
 assert.deepEqual(filtered({provider:'b',quality:'4K',cache:'Cached'},'quality'),[1]);
 assert.deepEqual(filtered({provider:'b'},'small'),[1,2,3]);
 assert.deepEqual(filtered({provider:'b'},'large'),[2,1,3]);
 assert.deepEqual(filtered({},'seeds'),[0,1,2,3]);
 assert.deepEqual(filtered({provider:'a',quality:'4K'},'quality'),[]);
 assert.match(opts.innerHTML,/No matching streams/);
 x.node('#streamClearFilters').onclick();
 assert.match(opts.innerHTML,/Showing 1–4 of 4/);
});

test('numeric resolution, inline language labels and the outgoing subtitle track agree',()=>{
 const x=addonHarness();
 const raw={resolution:'3840×2160',description:'Audio: en / ja | Subtitles: Spanish, Japanese',subtitles:[
  {lang:'es',url:'https://captions.example/es.vtt'},{lang:'ja',url:'https://captions.example/ja.vtt'}]};
 const serialized=JSON.stringify(raw);
 const info=x.run('LumaAddons._test.streamInfo({provider:"Fixture",raw:'+serialized+'},0)');
 assert.equal(info.quality.tag,'4K');
 assert.deepEqual([...info.fields.audio],['English','Japanese']);
 assert.deepEqual([...info.fields.subtitles],['Spanish','Japanese']);
 assert.equal(x.run('LumaAddons._test.subtitleURL('+serialized+',"Japanese")'),raw.subtitles[1].url);
 assert.equal(x.run('LumaAddons._test.subtitleURL('+serialized+',"French")'),'');
 assert.equal(x.run('LumaAddons._test.subtitleURL('+serialized+')'),raw.subtitles[0].url);
 for(const resolution of [1080,{width:1920,height:1080},'1920x1080']){
  const record=x.run('LumaAddons._test.streamInfo({provider:"F",raw:{resolution:'+JSON.stringify(resolution)+'}},0)');
  assert.equal(record.quality.tag,'1080p');
 }
});

test('each provider updates immediately and all its releases participate in search and facet counts',async()=>{
 const x=addonHarness();
 const providers=['early','middle','late'].map(id=>({url:'https://'+id+'.example/manifest.json',enabled:true,manifest:{id,name:id,types:['movie'],resources:['stream']}}));
 x.run('LumaAddons._test.prepareProviders('+JSON.stringify(providers)+')');
 x.run('var waiting={};fetch=url=>new Promise(resolve=>waiting[new URL(url).hostname.split(".")[0]]=rows=>resolve({ok:true,json:async()=>({streams:rows})}))');
 const done=x.run('LumaAddons._test.getStreams(null,null)');
 const html=()=>x.node('#modal').innerHTML;
 assert.match(html(),/Checking early, middle, late/);
 x.run('waiting.early([{name:"720p",title:"First",url:"https://example.test/first"}])');
 await new Promise(setImmediate);
 assert.match(html(),/1 source ·/);assert.match(html(),/Checking middle, late/);
 x.run('waiting.middle(Array.from({length:125},(_,i)=>({name:i===124?"4K":"1080p",title:"Release "+i,url:"https://example.test/"+i})))');
 await new Promise(setImmediate);
 assert.match(html(),/126 sources/);assert.match(html(),/Checking late/);
 x.run('LumaAddons._test.setQuery("Release 124")');
 assert.match(html(),/Showing 1–1 of 1/);assert.match(html(),/data-source="125"/);
 x.run('LumaAddons._test.setQuery("");LumaAddons._test.setFilters({provider:"early"},"quality")');
 const qualities=html().match(/id="stream-quality"[^>]*>([\s\S]+?)<\/select>/)[1];
 assert.match(qualities,/720p \(1\)/);assert.doesNotMatch(qualities,/4K|1080p/);
 x.run('waiting.late([])');await done;assert.doesNotMatch(html(),/Checking late/);
});

test("hero alternates recently dated movies and shows ahead of older saved titles",()=>{
 const x=appHarness(),day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
 x.ctx.titles=[["old","Series",500],["future","Movie",-3],["movie","Movie",2],["second","Movie",4],["show","Series",3]].map(([id,type,age])=>({id,title:id,type,usReleaseDate:day(age),poster:"https://example.org/p.jpg"}));
 x.ctx.titles.push({...x.ctx.titles[0],id:"returning",title:"Returning",heroEpisodeDate:day(1)});
 assert.deepEqual(Array.from(x.run("featuredDiscovery(titles).picks.map(x=>x.id)")),["movie","show","second"]);
 x.ctx.titles=[{...x.ctx.titles[2],usReleaseDate:"",date:day(1),origin_country:["US"]}];
 assert.equal(x.run("featuredDiscovery(titles).picks.length"),0);
});
