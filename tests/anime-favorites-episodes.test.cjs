"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const vm=require("node:vm"),fs=require("node:fs");
const catalogSource=fs.readFileSync("catalog-plus.js","utf8");
const appSource=fs.readFileSync("app.js","utf8");
function store(initial={}){
 const map=new Map(Object.entries(initial));
 return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))};
}
function catalogHarness(){
 const media={
  11:{id:11,idMal:111,title:{english:"Adventure"},format:"TV",episodes:12,startDate:{year:2020},
      relations:{edges:[{relationType:"SEQUEL",node:{id:12}}]}},
  12:{id:12,idMal:112,title:{english:"Adventure Season 2"},format:"TV",episodes:11,startDate:{year:2021},
      relations:{edges:[{relationType:"PREQUEL",node:{id:11}},{relationType:"SEQUEL",node:{id:13}}]}},
  13:{id:13,idMal:113,title:{english:"Adventure Season 3"},format:"TV",episodes:13,startDate:{year:2022},
      relations:{edges:[{relationType:"PREQUEL",node:{id:12}}]}},
  99:{id:99,title:{english:"Adventure Season 2"},format:"TV",episodes:24,startDate:{year:2021},relations:{edges:[]}}
 };
 const ctx={URL,AbortController,setTimeout,clearTimeout,console,
  fetch:async(url,opts)=>{if(String(url)!=="https://graphql.anilist.co")throw Error("No other provider expected");
   const body=JSON.parse(opts.body);
   if(body.variables.id)return{ok:true,json:async()=>({data:{Media:media[body.variables.id]}})};
   return{ok:true,json:async()=>({data:{Page:{media:Object.values(media),pageInfo:{hasNextPage:false}}}})};
  }};
 vm.createContext(ctx);vm.runInContext(catalogSource,ctx);
 return {run:s=>vm.runInContext(s,ctx)};
}
function appHarness(){
 const localStorage=store(),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:"",textContent:"",value:"",dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},onclick:null,focus(){},addEventListener(){},children:[]});return nodes.get(id)};
 const document={querySelector:node,querySelectorAll:()=>[],documentElement:{dataset:{},style:{setProperty(){}}},body:{classList:{add(){},remove(){}},dataset:{}},addEventListener(){}};
 const ctx={document,localStorage,window:{addEventListener(){}},location:{origin:"https://example.test"},navigator:{},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,
  LumaReleases:{all:()=>[],label:()=>"",bind(){},refresh:async()=>{}},LumaCalendar:{registerFollow(){},prime:async()=>{}},
  LumaAccounts:{deviceItems:()=>[],watchlistMarkup:()=>"",watchlistBind(){}},
  LumaCollections:{find:()=>null,collectionID:()=>""},LumaPeople:{markup:()=>"",bind(){}},
  LumaAddons:{installed:()=>false},fetch:async()=>({ok:true,json:async()=>[]}),scrollTo(){}};
 vm.createContext(ctx);vm.runInContext(appSource.replace("discover();LumaCalendar.prime().catch(()=>{});","LumaCalendar.prime().catch(()=>{});"),ctx);
 vm.runInContext("render=function(){};refreshLastAired=function(){};",ctx);
 return {run:s=>vm.runInContext(s,ctx),storage:localStorage};
}
test("AniList groups verified sequel seasons, not unrelated anime with similar names",async()=>{
 const h=catalogHarness();
 const rows=h.run("Object.values(({11:11,12:12,13:13,99:99})).map(i=>i)");
 assert.equal(rows.length,4);
 const grouped=h.run("LumaCatalogPlus.groupCatalogRows(["+
  'LumaCatalogPlus.normalizeAnime({id:11,title:{english:"Adventure"},startDate:{year:2020},relations:{edges:[{relationType:"SEQUEL",node:{id:12}}]}}),'+
  'LumaCatalogPlus.normalizeAnime({id:12,title:{english:"Adventure Season 2"},startDate:{year:2021},relations:{edges:[{relationType:"PREQUEL",node:{id:11}},{relationType:"SEQUEL",node:{id:13}}]}}),'+
  'LumaCatalogPlus.normalizeAnime({id:13,title:{english:"Adventure Season 3"},startDate:{year:2022},relations:{edges:[{relationType:"PREQUEL",node:{id:12}}]}}),'+
  'LumaCatalogPlus.normalizeAnime({id:99,title:{english:"Adventure Season 2"},startDate:{year:2021}})'+
  "])");
 assert.deepEqual(Array.from(grouped,x=>x.animeId),[11,99]);
 const family=await h.run("LumaCatalogPlus.animeFamily({animeId:13})");
 assert.equal(family.root.animeId,11);
 assert.deepEqual(Array.from(family.entries,x=>x.animeId),[11,12,13]);
 assert.equal(family.selectedId,13);
});
test("Favorites and Watchlist save independently, remain in separate library collections and survive backup restore",()=>{
 const h=appHarness();
 h.run('state.items=[{id:"film:1",title:"Test film",type:"Movie"},{id:"film:2",title:"Second film",type:"Movie"}]');
 h.run('toggleFavorite("film:1")');
 assert.deepEqual(JSON.parse(h.storage.getItem("luma.v2.favorites")),["film:1"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),[]);
 h.run('toggleWatch("film:2")');
 assert.deepEqual(JSON.parse(h.storage.getItem("luma.v2.watch")),["film:2"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),["film:1"]);
 assert.equal(h.run("libraryGroups().favorites.length"),1);
 assert.equal(h.run("libraryGroups().saved.length"),1);
 assert.match(h.run("favoritesMarkup()"),/Test film/);
 const backup=h.run('cleanBackup({watch:["film:2"],favorites:["film:1"],watched:[],library:[]})');
 h.run('state.watch=[];state.favorites=[]');
 h.run('applyBackup(cleanBackup({watch:["film:2"],favorites:["film:1"],watched:[],library:[]}))');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["film:2"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),["film:1"]);
 assert.equal(Array.from(backup.favorites)[0],"film:1");
 h.run('toggleFavorite("film:1")');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["film:2"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),[]);
});
test("Each episode can be marked watched and unwatched without changing other episodes",()=>{
 const h=appHarness();
 h.run('state.season=2');
 h.run('var show={id:"anilist:11",type:"Anime",title:"Adventure"};var ep1={season_number:2,episode_number:1};var ep2={season_number:2,episode_number:2};');
 let markup=h.run('episodeHTML([{season_number:2,episode_number:1,name:"Episode 1"},{season_number:2,episode_number:2,name:"Episode 2"}],show)');
 assert.match(markup,/data-episode-watch="2:1"/);
 assert.match(markup,/data-episode-watch="2:2"/);
 assert.match(markup,/Mark watched/);
 h.run('setEpisodeWatched(show,ep1,true)');
 assert.equal(h.run('episodeIsWatched(show,ep1)'),true);
 assert.equal(h.run('episodeIsWatched(show,ep2)'),false);
 h.run('state.progress["anilist:11:s2e1"]={fraction:1,seconds:500,updated:1}');
 h.run('setEpisodeWatched(show,ep1,false)');
 assert.equal(h.run('episodeIsWatched(show,ep1)'),false);
 assert.equal(h.run('state.progress["anilist:11:s2e1"]'),undefined);
 assert.equal(h.run('episodeIsWatched(show,ep2)'),false);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),[]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),[]);
 markup=h.run('episodeHTML([{season_number:2,episode_number:1,name:"Episode 1"}],show)');
 assert.match(markup,/aria-pressed="false"/);
});
