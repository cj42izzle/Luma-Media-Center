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
 return {run:s=>vm.runInContext(s,ctx),storage:localStorage,node,ctx};
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

test("Mark title watched synchronizes actual aired episodes across seasons and skips future episodes",()=>{
 const h=appHarness();
 h.run('var tvShow={id:"tvmaze:42",type:"Series",title:"A Series",source:"tvmaze"};'
  +'var aired1={season_number:1,episode_number:1,air_date:"2023-01-01"},'
  +'aired2={season_number:2,episode_number:1,air_date:"2024-01-01"},'
  +'future={season_number:2,episode_number:2,air_date:"2099-06-01"};'
  +'state.details={_tvmazeEpisodes:true,episodes:[aired1,aired2,future]};');
 assert.equal(h.run('setTitleWatched(tvShow,true)'),true);
 assert.equal(h.run('state.watched.includes("tvmaze:42")'),true);
 assert.equal(h.run('episodeIsWatched(tvShow,aired1)'),true);
 assert.equal(h.run('episodeIsWatched(tvShow,aired2)'),true);
 assert.equal(h.run('episodeIsWatched(tvShow,future)'),false);
 const stored=JSON.parse(h.storage.getItem("luma.v2.watched"));
 assert.ok(stored.includes("tvmaze:42:s1e1"));
 assert.ok(stored.includes("tvmaze:42:s2e1"));
 assert.ok(stored.some(s=>s.startsWith("tvmaze:42:watched-through:")));
 assert.ok(!stored.includes("tvmaze:42:s2e2"));
});
test("A season can be independently marked watched/unwatched without changing another season",()=>{
 const h=appHarness();
 h.run('var show={id:"tvmaze:100",type:"Series",title:"The Show"};'
  +'var one={season_number:1,episode_number:1,air_date:"2023-01-01"},'
  +'two={season_number:2,episode_number:1,air_date:"2024-01-01"},'
  +'future={season_number:2,episode_number:2,air_date:"2099-01-01"};'
  +'state.details={_tvmazeEpisodes:true,episodes:[one,two,future]};');
 h.run('setTitleWatched(show,true)');
 assert.equal(h.run('setSeasonWatched(show,2,false)'),true);
 assert.equal(h.run('episodeIsWatched(show,one)'),true);
 assert.equal(h.run('episodeIsWatched(show,two)'),false);
 assert.equal(h.run('setSeasonWatched(show,2,true)'),true);
 assert.equal(h.run('episodeIsWatched(show,one)'),true);
 assert.equal(h.run('episodeIsWatched(show,two)'),true);
 assert.equal(h.run('episodeIsWatched(show,future)'),false);
 assert.equal(h.run('setEpisodeWatched(show,two,false)'),true);
 assert.equal(h.run('episodeIsWatched(show,two)'),false);
 assert.equal(h.run('episodeIsWatched(show,one)'),true);
 assert.equal(h.run('setEpisodeWatched(show,two,true)'),true);
 assert.equal(h.run('episodeIsWatched(show,two)'),true);
 const watched=JSON.parse(h.storage.getItem('luma.v2.watched'));
 assert.equal(watched.length,new Set(watched).size);
});
test("Unmarking a title restores unwatched episodes without touching another title or viewer",()=>{
 const h=appHarness();
 h.run('var first={id:"tvmaze:9",type:"Series",title:"First"},'
  +'second={id:"tvmaze:10",type:"Series",title:"Second"};'
  +'var ep={season_number:1,episode_number:1,air_date:"2020-01-01"};'
  +'state.details={_tvmazeEpisodes:true,episodes:[ep]};');
 h.run('setEpisodeWatched(second,ep,true)');
 h.run('setTitleWatched(first,true)');
 assert.equal(h.run('setTitleWatched(first,false)'),true);
 assert.equal(h.run('episodeIsWatched(first,ep)'),false);
 assert.equal(h.run('episodeIsWatched(second,ep)'),true);
 assert.deepEqual(JSON.parse(h.storage.getItem('luma.v2.watched')),["tvmaze:10:s1e1"]);
});
test("Mark latest aired actually updates the individual episode and its watched icon",()=>{
 const h=appHarness();
 h.run('var show={id:"tvmaze:501",type:"Series",title:"Recent Episode",source:"tvmaze"};'
   +'var ep={season_number:3,episode_number:5,air_date:"2025-01-01"};'
   +'state.selected=show;state.season=3;state.details={_tvmazeEpisodes:true,episodes:[ep]};'
   +'saveLastAired(show,{season:3,number:5,airdate:"2025-01-01"});'
   +'showDetails=function(){};bindLatestAired(show);');
 assert.equal(typeof h.node("#markLastAired").onclick,"function");
 h.node("#markLastAired").onclick();
 assert.equal(h.run('episodeIsWatched(show,ep)'),true);
 assert.ok(JSON.parse(h.storage.getItem("luma.v2.watched")).includes("tvmaze:501:s3e5"));
 assert.match(h.run('episodeHTML([ep],show)'),/aria-pressed="true"/);
 h.run('bindLatestAired(show)');
 h.node("#markLastAired").onclick();
 assert.equal(h.run('episodeIsWatched(show,ep)'),false);
 assert.match(h.run('episodeHTML([ep],show)'),/aria-pressed="false"/);
});
test("Legacy title-watched records are interpreted against a saved cutoff, not future episodes",()=>{
 const h=appHarness();
 h.run('var show={id:"tvmaze:701",type:"Series",title:"Legacy"};'
   +'var old={season_number:1,episode_number:1,air_date:"2020-01-01"},'
   +'future={season_number:3,episode_number:1,air_date:"2099-01-01"};'
   +'state.watched=["tvmaze:701"];ensureTitleWatchedCutoff(show);');
 assert.equal(h.run('episodeIsWatched(show,old)'),true);
 assert.equal(h.run('episodeIsWatched(show,future)'),false);
 assert.ok(JSON.parse(h.storage.getItem("luma.v2.watched")).some(k=>k.startsWith("tvmaze:701:watched-through:")));
});
