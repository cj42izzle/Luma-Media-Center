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
