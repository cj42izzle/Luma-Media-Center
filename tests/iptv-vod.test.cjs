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
test('app includes IPTV and manifest source chooser',()=>{
 assert.match(html,/LumaVOD.choose/);assert.match(html,/iptv-vod\.js/);assert.match(html,/manifest\(\)/);
});
