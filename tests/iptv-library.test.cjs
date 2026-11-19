"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const vod=fs.readFileSync("iptv-vod.js","utf8");
const lib=fs.readFileSync("iptv-library.js","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
function setup(){
 const store=new Map();
 const context={URL,URLSearchParams,Date,console,window:{},setTimeout,clearTimeout,
  localStorage:{getItem:key=>store.get(key)||null,setItem:(k,v)=>store.set(k,v)}};
 vm.createContext(context);vm.runInContext(vod,context);
 return expr=>vm.runInContext(expr,context);
}
test("IPTV VOD catalog groups repeated movie sources without publishing stream credentials",()=>{
 const x=setup();
 const rows=[
   {name:"Blue Horizon (2025) 1080p",group:"Movies",provider:"IPTV One",url:"https://stream.example/movie/private-pass/1.mp4"},
   {name:"Blue Horizon (2025) 4K",group:"Movies",provider:"IPTV Two",url:"https://stream.example/movie/private-pass/2.mp4"},
   {name:"North Shore S01E01",group:"Series",provider:"IPTV One",url:"https://stream.example/series/private-pass/3.mp4"},
   {name:"North Shore S01E02",group:"Series",provider:"IPTV One",url:"https://stream.example/series/private-pass/4.mp4"}
 ];
 x("LumaVOD.setRows("+JSON.stringify(rows)+")");
 const result=x("LumaVOD.catalog()");
 assert.equal(result.length,2);
 assert.equal(result.find(i=>i.type==="Movie").providers.length,2);
 assert.equal(result.find(i=>i.type==="Series").episodeCount,2);
 assert.doesNotMatch(JSON.stringify(result),/private-pass|stream\.example/);
});
test("M3U seasons expose individual episode selections without exposing URLs",()=>{
 const x=setup();
 const rows=[
  {name:"City Lights S02E01",group:"TV Series",url:"https://iptv.example/series/1"},
  {name:"City Lights S02E02",group:"TV Series",url:"https://iptv.example/series/2"},
  {name:"City Lights S02E02",group:"TV Series",url:"https://iptv.example/series/3"}
 ];
 x("LumaVOD.setRows("+JSON.stringify(rows)+")");
 const episodes=x('LumaVOD.episodes("City Lights")');
 assert.equal(episodes.length,2);
 assert.deepEqual(Array.from(episodes, e=>e.number),[1,2]);
 assert.doesNotMatch(JSON.stringify(episodes),/iptv\.example/);
});
test("new IPTV Library is routed from Luma and includes protected companion searches",()=>{
 assert.match(app,/\["IPTV Library","▤"\]/);
 assert.match(app,/LumaVODLibrary\.render\(\)/);
 assert.match(html,/iptv-library\.css/);
 assert.match(html,/iptv-library\.js/);
 assert.match(lib,/\/vod\/catalog\?/);
 assert.match(lib,/\/vod\/episodes\?/);
 assert.match(lib,/Authorization:"Bearer "/);
 assert.match(lib,/data-play-episode/);
});
