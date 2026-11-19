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
test('HTTP Xtream can be saved without a PC or HTTPS retry, but is not called connected',async()=>{
 const saved=new Map(),called=[];
 const context={URL,URLSearchParams,Math,JSON,Date,AbortController,setTimeout,clearTimeout,location:{protocol:"https:"},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{called.push(url);throw new Error("Browser must not fetch HTTP IPTV")}};
 vm.createContext(context);vm.runInContext(script,context);
 const result=await vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Example IPTV',server:'http://panel.example:80',username:'demo',password:'fixture',output:'m3u8'})",context);
 assert.equal(result.ok,true);
 assert.equal(result.importRequired,true);
 assert.equal(result.channels,0);
 assert.equal(called.length,0);
 const cfg=JSON.parse(saved.get('luma.iptv.v1'));
 assert.equal(cfg.browserSources[0].server,'http://panel.example:80');
 assert.equal(cfg.browserSources[0].connection_mode,'device-import');
 assert.equal(vm.runInContext('LumaIPTV.getConfig().browserSources[0].password',context),'••••');
 assert.equal(vm.runInContext('LumaIPTV.isRecorderConnected()',context),false);
});
test('imported HTTP M3U channels remain available on a fresh app load',async()=>{
 const saved=new Map(),called=[];
 const make=()=>({
  URL,URLSearchParams,Math,JSON,Date,AbortController,setTimeout,clearTimeout,location:{protocol:"https:"},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{called.push(url);throw Error("Imported channels must not fetch HTTP") }
 });
 const first=make();vm.createContext(first);vm.runInContext(script,first);
 const account=await vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Example IPTV',server:'http://panel.example',username:'demo',password:'fixture'})",first);
 first.playlist={size:250,text:async()=>['#EXTM3U','#EXTINF:-1 tvg-id="station.one" group-title="News",Station One','http://panel.example/live/demo/fixture/100.ts','#EXTINF:-1 tvg-id="station.two",Station Two','http://panel.example/live/demo/fixture/101.ts'].join(String.fromCharCode(10))};
 const result=await vm.runInContext("LumaIPTV.importPlaylistFile(playlist,"+JSON.stringify(account.provider_id)+")",first);
 assert.equal(result.imported,2);
 assert.equal(vm.runInContext('LumaIPTV.channels().length',first),2);
 assert.equal(called.length,0);
 const second=make();vm.createContext(second);vm.runInContext(script,second);
 await vm.runInContext('LumaIPTV.loadGuide()',second);
 assert.equal(vm.runInContext('LumaIPTV.channels().length',second),2);
 assert.equal(vm.runInContext('LumaIPTV.getConfig().importedChannels.length',second),0);
});
test('VLC launch only uses the native iOS app scheme with original provider host',async()=>{
 const saved=new Map(),loc={href:""};
 const context={URL,URLSearchParams,Math,JSON,Date,setTimeout,clearTimeout,location:{protocol:"https:"},window:{location:loc},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))}};
 vm.createContext(context);vm.runInContext(script,context);
 vm.runInContext("LumaIPTV.openInVLC({type:'xtream',server:'http://panel.example:80',username:'demo',password:'fixture',output:'m3u8'})",context);
 assert.ok(loc.href.startsWith('vlc-x-callback://x-callback-url/stream?url='));
 const u=new URL(new URL(loc.href).searchParams.get('url'));
 assert.equal(u.protocol,'http:');
 assert.equal(u.hostname,'panel.example');
 assert.equal(u.pathname,'/get.php');
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
test('iPhone UI distinguishes saved HTTP IPTV from a connected channel feed',()=>{
 const portal=fs.readFileSync('iptv-portal.js','utf8');
 assert.match(portal,/Save HTTP IPTV for Luma native/);
 assert.match(portal,/result\.importRequired/);
 assert.doesNotMatch(script,/data-iptv-vlc/);
 assert.match(script,/Watch inside Luma/);
 assert.doesNotMatch(script,/iptvExternalPlayer/);
 assert.match(script,/data-iptv-import/);
 assert.match(script,/Account saved locally/);
 assert.match(script,/iptvQuickImportFile/);
});

test('XMLTV is able to mark live events and explicit premieres from guide metadata',()=>{
 assert.match(script,/is_live_event/);
 assert.match(script,/getElementsByTagName\("live"\)/);
 assert.match(script,/getElementsByTagName\("new"\)/);
});

test('completed DVR recordings can play in Luma without downloading a full file or launching external players',()=>{
 assert.match(script,/data-watch-recording/);
 assert.match(script,/async function watchRecording/);
 assert.match(script,/\/playback","POST"/);
 assert.match(script,/\/stream\?ticket=/);
 assert.match(script,/LumaPlayer\.open\(\{url,title:"Recording/);
 assert.match(script,/seriesKey/);
});
