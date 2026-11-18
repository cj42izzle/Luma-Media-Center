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
   'return {open,render,attachPlayerButtons,lookupTitle,installed:()=>list.length,_test:{validateManifest,endpoint,cleanStreamResults,renderStreams:(rows,failures)=>{streams=rows;streamFailures=failures;detail={title:"The Odyssey",poster:"https://images.example/poster.jpg",stremioID:"tt1234567"};showStreams("")}}};');
 vm.createContext(ctx);vm.runInContext(instrumented,ctx);
 return {run:code=>vm.runInContext(code,ctx),node};
}
test('served index is Live Build 30 with real image hero and episode UI',()=>{
 assert.match(html,/Luma · Live Build 30/);
 assert.match(html,/class="heroVisual"/);
 assert.match(html,/class="episode episodeCinematic"/);
 assert.match(html,/streamWarnings/);
 assert.match(html,/\/\* Luma cinematic experience v30/);
});
test('home feature renders a real image and more varied media rows',()=>{
 const x=appHarness();
 const page=x.run('hero([{id:"movie",title:"A Beautiful Story",type:"Movie",year:"2026",poster:"https://images.example/poster.jpg",overview:"A grand adventure",genreNames:["Drama"]}])');
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
