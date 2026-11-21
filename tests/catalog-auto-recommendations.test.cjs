"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const app=fs.readFileSync("app.js","utf8"),collections=fs.readFileSync("collections.js","utf8"),index=fs.readFileSync("index.html","utf8");
function harness(){
 const saved=new Map(),nodes=new Map(),events=[],loaded=[];
 function node(id){
  if(!nodes.has(id))nodes.set(id,{
   innerHTML:"",textContent:"",value:"",dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},
   addEventListener(){},focus(){},scrollIntoView(options){events.push({id,options})},
   getBoundingClientRect(){return {top:5000}},children:[]
  });
  return nodes.get(id);
 }
 const document={querySelector:node,querySelectorAll:()=>[],documentElement:{dataset:{tv:"false"},style:{setProperty(){}}},
  body:{classList:{add(){},remove(){}},dataset:{}},addEventListener(){},activeElement:null};
 const ctx={document,window:{addEventListener(){},innerHeight:700},localStorage:{
  getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))
 },location:{origin:"https://test.example",search:""},navigator:{},
  URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,
  LumaReleases:{all:()=>[],refresh:async()=>{},label:()=>"",bind(){},feed:()=>[]},
  LumaCalendar:{prime:async()=>{},registerFollow(){},bindHome(){}},
  LumaAccounts:{deviceItems:()=>[],watchlistMarkup:()=>"",watchlistBind(){}},
  LumaCollections:{collectionID:()=>"",find:()=>null,renderCollection:()=>"",bind(){}},
  LumaPeople:{markup:()=>"",bind(){}},LumaAddons:{installed:()=>false},
  LumaCatalogPlus:{reset(){},groupCatalogRows:x=>x,seed:async()=>[],search:async()=>[],
   async loadMore(section){loaded.push(section);return {items:[
    {id:"new:"+section,title:"From "+section,type:section==="Anime"?"Anime":section==="Movies"?"Movie":"Series",
      year:"2026",genreNames:["Adventure"],source:"source"}],hasNext:false}}},
  fetch:async()=>({ok:true,json:async()=>[]}),scrollTo(){}
 };
 vm.createContext(ctx);
 const code=app.replace("paint();discover();LumaCalendar.prime().catch(()=>{});","paint();LumaCalendar.prime().catch(()=>{});");
 vm.runInContext(code,ctx);
 vm.runInContext("render=function(){};refreshLastAired=function(){};",ctx);
 return {run:s=>vm.runInContext(s,ctx),events,loaded};
}
test("background catalog pages load per medium without load-more buttons",async()=>{
 const h=harness();
 h.run('state.source="TVmaze and Apple Movies";state.loading=false;state.q="";state.items=[{id:"old",title:"Old title",type:"Movie",source:"tvmaze"}]');
 assert.equal(await h.run('loadMoreCatalog("Movies",true)'),true);
 assert.equal(await h.run('loadMoreCatalog("Anime",true)'),true);
 assert.deepEqual(h.loaded,["Movies","Anime"]);
 assert.equal(h.run("state.items.length"),3);
 assert.equal(h.run('catalogAuto.ended.has("Movies")'),true);
 assert.equal(h.run('catalogAuto.ended.has("Anime")'),true);
 h.run('state.tab="Anime";state.q="";state.source="TVmaze and Apple Movies"');
 assert.doesNotMatch(h.run("catalogMarkup(state.items)"),/id="loadCatalogMore"/);
 assert.match(h.run("catalogMarkup(state.items)"),/load automatically|pages checked|catalogAutoSentinel/i);
 assert.match(app,/IntersectionObserver/);
 assert.match(app,/warmCatalog\(token\)/);
});
test("Next and Previous move back to top of the new results page",()=>{
 const h=harness();
 h.run("browse.page=0;goResultsPage(browse,'catalog',1)");
 assert.equal(h.run("browse.page"),1);
 assert.ok(h.events.some(x=>x.id==="#content .collectionGrid"&&x.options.block==="start"));
 h.events.length=0;
 h.run("libraryView.page=2;goResultsPage(libraryView,'library',-1)");
 assert.equal(h.run("libraryView.page"),1);
 assert.ok(h.events.some(x=>x.id==="#content .collectionGrid"&&x.options.block==="start"));
 assert.match(fs.readFileSync("accounts.js","utf8"),/watchNext[^\n]*scrollIntoView/);
});
test("recommendations use loved, watched and watchlist signals but exclude previously viewed or saved titles",()=>{
 const h=harness();
 const candidates=[
  {id:"fav",title:"Starward",type:"Series",year:"2020",genreNames:["Adventure","Science Fiction"],overview:"A crew explores galaxies in their spaceship."},
  {id:"watched",title:"Case Files",type:"Series",year:"2021",genreNames:["Mystery","Drama"],overview:"Investigators solve difficult cases."},
  {id:"list",title:"Hidden Worlds",type:"Movie",year:"2024",genreNames:["Adventure","Mystery"],overview:"An exploration team investigates secrets."},
  {id:"new",title:"Stellar Quest",type:"Series",year:"2025",genreNames:["Adventure","Science Fiction"],overview:"A spaceship crew explores distant planets."},
  {id:"new2",title:"The Puzzle",type:"Movie",year:"2023",genreNames:["Mystery"],overview:"Two investigators uncover a secret."},
  {id:"again",title:"Case Files",type:"Series",year:"2021",genreNames:["Mystery","Drama"],overview:"Investigators solve difficult cases."},
  {id:"finished",title:"Finished Space",type:"Series",year:"2018",genreNames:["Adventure"],overview:"Outer-space adventures."},
  {id:"unrelated",title:"Cooking Tips",type:"Series",year:"2026",genreNames:["Cooking"],overview:"Classic dishes and meals."}
 ];
 h.run("state.items="+JSON.stringify(candidates));
 h.run('state.favorites=["fav"];state.watch=["list"];state.watched=["watched:s1e1"];state.progress={"finished:s1e2":{fraction:1,updated:10}};');
 const results=h.run("suggestedTitles(state.items)");
 const ids=Array.from(results,x=>x.id);
 assert.ok(ids.includes("new"),"Similar unwatched science-fiction series should appear");
 assert.ok(ids.includes("new2"),"Mystery watchlist interests should contribute");
 for(const id of ["fav","list","watched","again","finished","unrelated"])
  assert.ok(!ids.includes(id),"Should not recommend "+id);
 assert.ok(results.every(row=>String(row.recommendationReason||"").startsWith("Because you ")));
});
test("collection provider pages grow automatically without rendering enormous lists at once",()=>{
 assert.match(collections,/async function preloadCollection/);
 assert.match(collections,/id="collectionAutoSentinel"/);
 assert.match(collections,/items\.slice\(0,current\.visible\)/);
 assert.doesNotMatch(collections,/id="collectionLoad"/);
 assert.match(index,/src="\.\/catalog-plus\.js"/);
 assert.match(index,/catalog-auto\.css\?v=1/);
});
