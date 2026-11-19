'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('iptv-vod.js','utf8'),html=fs.readFileSync('index.html','utf8');
const ctx={URL,URLSearchParams,localStorage:{getItem:()=>null}};
vm.createContext(ctx);vm.runInContext(script,ctx);
test('M3U VOD movie and exact episode matching',()=>{
 const rows=vm.runInContext('LumaVOD.parse([{name:"The Matrix (1999) 4K",group:"Movies",url:"https://example.com/movie/1"},{name:"My Show S02E05 HD",group:"Series",url:"https://example.com/series/2/5"}])',ctx);
 assert.equal(rows.length,2);assert.equal(rows[0].type,'movie');
 assert.equal(vm.runInContext('LumaVOD.matches(LumaVOD.parse([{name:"My Show S02E05",group:"Series",url:"https://example.com/series/2/5"}]),{title:"My Show",type:"Series"},{season_number:2,episode_number:5}).length',ctx),1);
 assert.equal(vm.runInContext('LumaVOD.matches(LumaVOD.parse([{name:"My Show S02E05",group:"Series",url:"https://example.com/series/2/5"}]),{title:"My Show",type:"Series"},{season_number:2,episode_number:6}).length',ctx),0);
});
test('alternate episode formats and international titles match exactly',()=>{
 assert.equal(vm.runInContext('LumaVOD.matches(LumaVOD.parse([{name:"Café Adventures 2x05 HD",group:"Series",url:"https://example.com/series/cafe"}]),{title:"Café Adventures",type:"Series"},{season_number:2,episode_number:5}).length',ctx),1);
 assert.equal(vm.runInContext('LumaVOD.matches(LumaVOD.parse([{name:"Another Show Season 2 Episode 7",group:"Series",url:"https://example.com/series/show"}]),{title:"Another Show",type:"Series"},{season_number:2,episode_number:6}).length',ctx),0);
});
test('offline recorder does not hide IPTV sources imported from another service',async()=>{
 const testCtx={URL,URLSearchParams,Date,localStorage:{getItem:()=>JSON.stringify({host:"https://offline.example",token:"private"})},fetch:async()=>{throw Error("offline")}};
 vm.createContext(testCtx);vm.runInContext(script,testCtx);
 const matches=await vm.runInContext('LumaVOD.setRows([{name:"My Show S02E05",group:"Series",url:"https://provider.example/series/5",provider:"Second IPTV"}]); LumaVOD.find({title:"My Show",type:"Series"},{season_number:2,episode_number:5})',testCtx);
 assert.equal(matches.length,1);assert.equal(matches[0].provider,"Second IPTV");
});
test('app includes IPTV and manifest source chooser',()=>{
 assert.match(html,/LumaVOD.choose/);assert.match(html,/iptv-vod\.js/);assert.match(html,/manifest\(\)/);
});

test('source chooser has a separate responsive layout and remains selectable by episode',()=>{
 assert.match(script,/lumaVodChooser/);
 assert.match(script,/data-iptv-play/);
 assert.doesNotMatch(script,/data-iptv-out/);
 assert.match(script,/data-iptv-play/);
 assert.match(html,/iptv-vod\.css/);
});

test('Xtream provider catalogs add movies, series, and clickable episode sources without exposing credentials in catalog',async()=>{
 const local={URL,JSON,Date,console,window:{},localStorage:{getItem:()=>null},
  LumaIPTV:{xtreamById:async()=>({episodes:{"2":[{id:44,season:2,episode_num:5,container_extension:"mp4",title:"Episode Five"}]}}),
  xtreamStreamURL:(provider,kind,id,ext)=>"https://tv.example/"+kind+"/"+id+"."+ext}};
 vm.createContext(local);vm.runInContext(script,local);
 vm.runInContext('LumaVOD.setXtreamCatalog([{provider_id:"p1",provider:"Demo IPTV",movies:[{name:"Film (2026) 4K",stream_id:14,container_extension:"mp4"}],series:[{name:"TV Show",series_id:9}]}])',local);
 const catalog=vm.runInContext('LumaVOD.catalog()',local);
 assert.equal(catalog.length,2);
 assert.equal(catalog.find(x=>x.type==='Movie').title,'Film');
 assert.doesNotMatch(JSON.stringify(catalog),/tv\.example|fixture/);
 const episodes=await vm.runInContext("LumaVOD.getEpisodes('TV Show')",local);
 assert.equal(episodes.length,1);
 assert.equal(episodes[0].season,2);assert.equal(episodes[0].number,5);
 const film=await vm.runInContext("LumaVOD.find({title:'Film',type:'Movie',year:'2026'})",local);
 assert.equal(film.length,1);assert.match(film[0].url,/movie\/14\.mp4$/);
 const ep=await vm.runInContext("LumaVOD.find({title:'TV Show',type:'Series'},{season_number:2,episode_number:5})",local);
 assert.equal(ep.length,1);assert.match(ep[0].url,/series\/44\.mp4$/);
});
