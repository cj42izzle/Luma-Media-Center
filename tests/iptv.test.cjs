'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('iptv.js','utf8'),html=fs.readFileSync('index.html','utf8');
function setup(){
 const saved=new Map();
 const context={URL,Math,JSON,Date,console,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(script,context);
 return {context,eval:code=>vm.runInContext(code,context)};
}
test('the Live TV UI and main navigation are part of the served standalone site',()=>{
 assert.ok(html.includes(script.trim()),'Standalone HTML must include the current IPTV module');
 assert.match(html,/\["Live TV","▣"\]/);
 assert.match(html,/LumaIPTV\.render\(state\.tab===/);
 assert.match(html,/\["Guide","▦"\]/);
 assert.match(html,/\["Recordings","●"\]/);
 assert.match(html,/iptv-portal\.js/);
 assert.match(html,/iptvGuidePager/);
 assert.match(html,/iptvRecordChannelNow/);
 assert.match(html,/iptvSeriesMode/);
});
test('M3U parser reads multiple channels with group and guide ID',()=>{
 const x=setup();
 const r=x.eval("LumaIPTV.parseM3U('#EXTM3U\\n#EXTINF:-1 tvg-id=\"ch1\" group-title=\"News\",Channel HD\\nhttps://media.example/ch1.m3u8\\n#EXTINF:-1 tvg-id=\"ch2\" group-title=\"Sports\",Channel 4K\\nhttps://media.example/ch2.m3u8')");
 assert.equal(r.length,2);
 assert.equal(r[0].epg_id,'ch1');
 assert.equal(r[0].group,'News');
 assert.equal(r[1].quality,2);
});
test('XMLTV timestamps convert timezone offsets and ignore malformed strings',()=>{
 const x=setup();
 assert.equal(x.eval("LumaIPTV.xmlTime('20261118160000 -0800')"),Date.UTC(2026,10,19,0,0,0));
 assert.equal(x.eval("LumaIPTV.xmlTime('20261118160000 +0200')"),Date.UTC(2026,10,18,14,0,0));
 assert.equal(x.eval("LumaIPTV.xmlTime('nonsense')"),0);
});

test('HTTP IPTV panel URLs are upgraded only on the same host and standard HTTPS port',()=>{
 const x=setup();
 assert.equal(x.eval("LumaIPTV.secureFeedURL('http://panel.example:80/')"),"https://panel.example");
 assert.equal(x.eval("LumaIPTV.secureFeedURL('http://panel.example/xtream/')"),"https://panel.example/xtream");
 assert.equal(x.eval("LumaIPTV.secureFeedURL('https://panel.example:443/')"),"https://panel.example");
 assert.equal(x.eval("LumaIPTV.secureFeedURL('http://panel.example:8080/')"),"");
 assert.equal(x.eval("LumaIPTV.secureFeedURL('http://user:secret@panel.example/')"),"");
});
test('submitting a browser-only HTTP Xtream connection never fetches an insecure URL',async()=>{
 const saved=new Map(),called=[];
 const context={URL,Math,JSON,Date,AbortController,setTimeout,clearTimeout,location:{protocol:"https:"},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{
   called.push(new URL(url));
   return {ok:true,text:async()=>url.includes("/xmltv.php")?"<tv></tv>":'#EXTM3U\\n#EXTINF:-1 tvg-id="test",Test Channel\\nhttps://example.test/stream.m3u8'};
  }};
 vm.createContext(context);vm.runInContext(script,context);
 const result=await vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Example IPTV',server:'http://panel.example:80',username:'demo',password:'fixture',output:'m3u8'})",context);
 assert.equal(result.ok,true);
 assert.ok(called.length>=1);
 assert.ok(called.every(u=>u.protocol==="https:"&&u.hostname==="panel.example"));
 const cfg=JSON.parse(saved.get('luma.iptv.v1'));
 assert.equal(cfg.browserSources[0].server,'https://panel.example');
 assert.equal(vm.runInContext('LumaIPTV.getConfig().browserSources[0].password',context),'••••');
});
test('failed secure retry does not persist a broken Xtream connection',async()=>{
 const saved=new Map(),called=[];
 const context={URL,Math,JSON,Date,AbortController,setTimeout,clearTimeout,location:{protocol:"https:"},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{called.push(new URL(url));throw new TypeError("Failed to fetch")}};
 vm.createContext(context);vm.runInContext(script,context);
 await assert.rejects(vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Example',server:'http://panel.example:80',username:'demo',password:'fixture'})",context),/No connection was saved/);
 assert.ok(called.length>0&&called.every(u=>u.protocol==='https:'));
 assert.equal(saved.has('luma.iptv.v1'),false);
});

test('unsupported URLs do not become playable playlist entries',()=>{
 const x=setup();
 const r=x.eval("LumaIPTV.parseM3U('#EXTM3U\\n#EXTINF:-1 tvg-id=\"ch1\",Dangerous Channel\\njavascript:alert(1)\\n#EXTINF:-1,Valid Channel\\nhttps://media.example/valid.m3u8')");
 assert.equal(r.length,1);
 assert.equal(r[0].name,'Valid Channel');
});

test('Android local DVR has native record, series, folder and history controls',()=>{
 assert.match(html,/iptv-native-dvr\.js/);
 const native=fs.readFileSync('iptv-native-dvr.js','utf8');
 for(const name of ['iptvRecordDeviceNow','iptvRecordDevice','iptvSeriesDevice','iptvChooseLocalFolder','decorateHistory','schedule'])assert.ok(native.includes(name));
});

test('guide supports video dock while keeping live channel grid in view',()=>{
 assert.match(script,/iptvWatchGuide/);
 assert.match(script,/openGuideMiniPlayer/);
 assert.match(script,/iptvMiniDock/);
 assert.match(html,/iptv-guide-v2\.css/);
});

test('on-device retry scans all IPTV programmes and exposes HEVC preference',()=>{
 const native=fs.readFileSync('iptv-native-retry.js','utf8');
 assert.match(html,/iptv-native-retry\.js/);
 assert.match(script,/LumaNativeRetry\.bind/);
 assert.match(native,/LumaIPTV\.programs\(\)/);
 assert.match(native,/LumaIPTV\.channels\(\)/);
 assert.match(native,/setHevc/);
 assert.match(native,/syncGuide/);
});

test('DVR history identifies cross-channel retries and H.265 conversion status',()=>{assert.match(script,/retry_pending/);assert.match(script,/hevc_complete/);assert.match(script,/saved_bytes/)});

test('Live TV portal includes server-free browse views and both service forms',()=>{
 const source=fs.readFileSync('iptv-portal.js','utf8');
 assert.match(script,/displayMode==="home"/);
 assert.match(script,/displayMode==="guide"/);
 assert.match(script,/displayMode==="recordings"/);
 assert.match(source,/iptvAddProviderXtream/);
 assert.match(source,/iptvAddProviderM3U/);
 assert.match(source,/provider/);
});
test('XMLTV is able to mark live events and explicit premieres from guide metadata',()=>{
 assert.match(script,/is_live_event/);
 assert.match(script,/getElementsByTagName\("live"\)/);
 assert.match(script,/getElementsByTagName\("new"\)/);
});
