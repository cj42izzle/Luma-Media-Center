"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const app=read("app.js"),releases=read("releases.js");
const html=read("index.html");
function harness(){
 const data=new Map(),nodes=new Map();
 const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,String(value))};
 const node=key=>{
  if(!nodes.has(key))nodes.set(key,{innerHTML:"",value:"",textContent:"",dataset:{},
   style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},
   addEventListener(){},focus(){},scrollIntoView(){},isConnected:false});
  return nodes.get(key);
 };
 const document={querySelector:node,querySelectorAll:()=>[],activeElement:null,
  body:{classList:{add(){},remove(){}},dataset:{}},documentElement:{dataset:{},style:{setProperty(){}}},addEventListener(){}};
 const ctx={document,window:{addEventListener(){}},navigator:{language:"en-US"},
  localStorage:storage,location:{origin:"https://fixture.test",pathname:"/",search:""},
  LumaReleases:{getRegion:()=>"US",regionName:()=>"United States",all:()=>[],label:()=>"",bind(){},refresh:async()=>{},enrichDetail(){}},
  LumaCalendar:{prime:async()=>{},bindHome(){},registerFollow(){}},
  LumaAccounts:{deviceItems:()=>[],watchlistMarkup:()=>"",watchlistBind(){}},
  LumaCollections:{find:()=>null,collectionID:()=>"",bind(){},open(){},renderCollection:()=>"",providerShowcase:()=>""},
  LumaPeople:{markup:()=>"",bind(){}},LumaAddons:{installed:()=>false,render(){}},
  URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,scrollTo(){}};
 vm.createContext(ctx);
 const safeBoot=app.replace("paint();discover();LumaCalendar.prime().catch(()=>{});","paint();LumaCalendar.prime().catch(()=>{});");
 assert.notEqual(safeBoot,app,"test bootstrap must be recognized");
 vm.runInContext(safeBoot,ctx);
 return {run:x=>vm.runInContext(x,ctx),storage};
}
test("For You is guided by watched, loved and watchlist, excluding all seen or saved titles",()=>{
 const h=harness();
 h.run('state.items=['+
  '{id:"fav",title:"Loved",type:"Series",year:"2024",tmdbId:11,genreNames:["Mystery","Drama"],poster:"https://img.test/f.jpg"},'+
  '{id:"saved",title:"Queued",type:"Movie",year:"2025",genreNames:["Drama"],poster:"https://img.test/w.jpg"},'+
  '{id:"seen",title:"Finished",type:"Series",year:"2023",tmdbId:33,genreNames:["Mystery"],poster:"https://img.test/s.jpg"},'+
  '{id:"different-source",title:"Finished",type:"Series",year:"2023",tmdbId:33,genreNames:["Mystery"],poster:"https://img.test/c.jpg"},'+
  '{id:"progress",title:"In progress",type:"Series",year:"2023",tmdbId:55,genreNames:["Mystery"],poster:"https://img.test/p.jpg"},'+
  '{id:"new",title:"New mystery",type:"Series",year:"2026",tmdbId:44,genreNames:["Mystery","Drama"],poster:"https://img.test/n.jpg"},'+
  '{id:"other",title:"Cooking",type:"Series",year:"2022",genreNames:["Cooking"],poster:"https://img.test/o.jpg"}'+
  '];state.favorites=["fav"];state.watch=["saved"];state.watched=["seen"];state.progress={"progress:s1e2":{fraction:.5}};');
 const ids=JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))"));
 assert.ok(ids.includes("new"),"related unwatched title should be suggested");
 for(const unwanted of ["fav","saved","seen","different-source","progress","other"])
  assert.ok(!ids.includes(unwanted),"not a new recommendation: "+unwanted);
 h.run('remoteRecommendationRows=[{id:"tmdb:tv:33",tmdbId:33,title:"Finished",type:"Series",year:"2023",recommendedByTMDB:3,genreNames:["Mystery"],poster:"https://img.test/x.jpg"}]');
 const fresh=JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))"));
 assert.ok(!fresh.includes("tmdb:tv:33"),"provider recommendations cannot reintroduce watched titles");
});
test("Country boosts require source-backed origin, and browser language starts the country preference",()=>{
 const h=harness();
 const ranked=JSON.parse(h.run('JSON.stringify(countrySorted(['+
  '{id:"fr",title:"Foreign",type:"Series",origin_country:["FR"],rating:8},'+
  '{id:"us",title:"American",type:"Series",origin_country:["US"],rating:7}],"US").map(x=>x.id))'));
 assert.deepEqual(ranked,["us","fr"]);
 const data=new Map();
 const context={navigator:{languages:["fr-CA","en-US"]},localStorage:{
  getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))}};
 vm.createContext(context);vm.runInContext(releases,context);
 assert.equal(vm.runInContext("LumaReleases.getRegion()",context),"CA");
 assert.equal(vm.runInContext('LumaReleases.setRegion("JP")',context),"JP");
 assert.equal(data.get("luma.region"),"JP");
 assert.ok(vm.runInContext("LumaReleases.REGION_NAMES.JP",context));
});
test("TV search moves to sidebar without header focus trap",()=>{
 const nav=read("tv-experience.js"),css=read("tv-experience.css");
 assert.match(nav,/id="lumaTvSidebarSearch"/);
 assert.match(app,/sidebarInput\?\.focus/);
 assert.match(css,/html\[data-tv="true"\] \.top \.searchWrap\{display:none!important/);
 assert.match(nav,/if\(typeof onSearch==="function"\)onSearch\(value\)/);
});
test("Catalog, providers and add-on feeds load additional source pages automatically",()=>{
 const sources=[app,read("collections.js"),read("addons.js"),read("catalog-plus.js")];
 assert.match(sources[0],/function bindAutoCatalog/);
 assert.match(sources[0],/id="catalogAutoLoad"/);
 assert.doesNotMatch(sources[0],/id="loadCatalogMore"/);
 assert.match(sources[1],/id="collectionAutoLoad"/);
 assert.match(sources[1],/function observeAutomaticPages/);
 assert.match(sources[2],/id="addonAutoMore"/);
 assert.match(sources[2],/function observeAddonPages/);
 assert.match(sources[3],/if\(section==="Catalogs"\)/);
 assert.match(sources[0],/goToResultsTop\(\)/);
 assert.match(read("accounts.js"),/scrollIntoView/);
});
test("Home shows personal recommendations without making unwatched titles appear as completed",()=>{
 assert.match(read("luma-home.js"),/shelf\("For You"/);
 assert.match(read("tv-experience.js"),/shelf\("For You"/);
 assert.match(app,/recommendations:suggestedTitles\(filtered\)/);
 assert.match(app,/recommendationIsUnseen/);
 assert.match(app,/refreshRecommendations/);
});
