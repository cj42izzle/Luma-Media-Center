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
test('HTTP Xtream is saved, and only the same-host secure URL is automatically checked in Safari',async()=>{
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
 assert.ok(called.length>0,'Luma checks for HTTPS availability automatically');
 assert.ok(called.every(u=>String(u).startsWith('https://panel.example/')),'Never request a plaintext HTTP IPTV feed from the HTTPS website');
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
 assert.ok(called.every(u=>String(u).startsWith('https://panel.example/')),'Imported channels never trigger browser HTTP fetches');
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
test('browser UI distinguishes saved HTTP IPTV from a connected channel feed on any device',()=>{
 const portal=fs.readFileSync('iptv-portal.js','utf8');
 assert.match(portal,/Save HTTP IPTV for Luma native/);
 assert.match(portal,/result\.importRequired/);
 assert.doesNotMatch(script,/data-iptv-vlc/);
 assert.match(script,/Watch inside Luma/);
 assert.doesNotMatch(script,/iptvExternalPlayer/);
 assert.match(script,/data-iptv-import/);
 assert.match(script,/Account saved in browser/);
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

test('saved HTTP service shows one clear status and no manual import wizard',()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'saved:test',type:'xtream',name:'Krooz TV',server:'http://tv.example:8080',
  username:'demo',password:'fixture',connection_mode:'device-import'
 }]})]]);
 const screen={innerHTML:''};
 const doc={querySelector:s=>s==='#content'?screen:null,querySelectorAll:()=>[],activeElement:{id:''}};
 const context={URL,URLSearchParams,Math,JSON,Date,console,document:doc,location:{protocol:'https:'},setTimeout,clearTimeout,
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))}};
 vm.createContext(context);vm.runInContext(script,context);
 for(const page of ['guide','home']){
  vm.runInContext("LumaIPTV.render("+JSON.stringify(page)+")",context);
  assert.match(screen.innerHTML,/Krooz TV is saved/);
  assert.match(screen.innerHTML,/Download Luma for Android TV/);
  assert.match(screen.innerHTML,/ios\/SIGNING\.md/);
  assert.doesNotMatch(screen.innerHTML,/id="iptvQuickRetry"/);
  assert.match(screen.innerHTML,/Account settings/);
  assert.match(screen.innerHTML,/signed Luma iPhone app/);
  assert.doesNotMatch(screen.innerHTML,/id="iptvRecoverImport"|id="iptvRecoverGuide"|Get provider playlist|Test same-host HTTPS|Import M3U from Files/);
  assert.doesNotMatch(screen.innerHTML,/0 channels · 1 saved service/);
  assert.doesNotMatch(screen.innerHTML,/id="iptvGuidePlaylistFile"/);
  assert.doesNotMatch(screen.innerHTML,/id="iptvGuideXmlFile"/);
  assert.doesNotMatch(screen.innerHTML,/fixture/);
 }
});
test('HTTPS recovery tests only an explicit secure provider URL and never fetches the saved HTTP URL',async()=>{
 const calls=[],saved=new Map();
 const playlist='#EXTM3U\n#EXTINF:-1 tvg-id="ch1",Channel One\nhttps://media.example/ch1.m3u8';
 const context={URL,URLSearchParams,Math,JSON,Date,console,AbortController,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},setTimeout,clearTimeout,
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async u=>{calls.push(String(u));return {ok:true,text:async()=>playlist}}};
 vm.createContext(context);vm.runInContext(script,context);
 const added=await vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Test TV',server:'http://panel.example:80',username:'test',password:'fake'})",context);
 assert.equal(added.importRequired,true);
 assert.ok(calls.every(url=>url.startsWith('https://panel.example/')),'Auto checks use only the original provider hostname');
 const result=await vm.runInContext("LumaIPTV.trySecureProvider("+JSON.stringify(added.provider_id)+")",context);
 assert.equal(result.channels,1);
 assert.ok(calls.length>0);
 assert.ok(calls.every(url=>url.startsWith('https://')));
 assert.equal(JSON.parse(saved.get('luma.iptv.v1')).browserSources[0].server,'http://panel.example:80');
 assert.equal(JSON.parse(saved.get('luma.iptv.v1')).browserSources[0].connection_mode,'browser-https');
});
test('Guide supports a separately imported XMLTV file after a playlist loads',()=>{
 assert.match(script,/async function importGuideFile\(file\)/);
 assert.match(script,/importGuideFile\(xmlfile\)/);
 assert.match(script,/data-iptv-download-epg/);
 assert.match(script,/id="iptvFileGuide"/);
 assert.match(html,/href="\.\/iptv\.css"/);
 assert.match(html,/href="\.\/iptv-guide-v2\.css"/);
});

test('Xtream HTTPS alternative must stay on the original hostname before credentials are used',async()=>{
 const calls=[],saved=new Map();
 const context={URL,URLSearchParams,Math,JSON,Date,console,AbortController,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},setTimeout,clearTimeout,
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{calls.push(url);throw Error('No request is allowed to an untrusted host')}};
 vm.createContext(context);vm.runInContext(script,context);
 const account=await vm.runInContext("LumaIPTV.addProvider({type:'xtream',name:'Test TV',server:'http://panel.example:80',username:'test',password:'fake'})",context);
 await assert.rejects(
  vm.runInContext("LumaIPTV.trySecureProvider("+JSON.stringify(account.provider_id)+",'https://other.example')",context),
  /same hostname/
 );
 assert.ok(calls.every(url=>String(url).startsWith('https://panel.example/')),'Wrong-host HTTPS credentials must not be sent to any other domain');
 const cfg=vm.runInContext("LumaIPTV.getConfig()",context);
 assert.equal(cfg.browserSources[0].password,'••••');
});


test('saved HTTP Xtream sources load automatically through the native player and EPG reader',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'saved:old',type:'xtream',name:'Test IPTV',server:'http://tv.example:8080',
  username:'fixture',password:'password',connection_mode:'device-import',output:'m3u8'
 }]})]]);
 const called=[];
 const context={URL,URLSearchParams,Math,JSON,Date,console,AbortController,
  setTimeout,clearTimeout,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  window:{LumaNativeIPTV:{fetchText:async url=>{
   called.push(String(url));
   if(String(url).includes('action=get_live_streams'))
    return JSON.stringify([{stream_id:14,name:'Sports Channel HD',epg_channel_id:'sports.tv',num:4}]);
   if(String(url).includes('xmltv.php'))return '<?xml version="1.0"?><tv/>';
   return '#EXTM3U\n#EXTINF:-1,Backup Channel\nhttp://tv.example/backup.ts';
  }}},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))}};
 vm.createContext(context);vm.runInContext(script,context);
 await vm.runInContext('LumaIPTV.loadGuide()',context);
 assert.equal(vm.runInContext('LumaIPTV.channels().length',context),1);
 assert.equal(vm.runInContext('LumaIPTV.channels()[0].epg_id',context),'sports.tv');
 assert.ok(called.some(url=>url.includes('action=get_live_streams')));
 assert.ok(called.some(url=>url.includes('xmltv.php')));
 assert.ok(called.every(url=>url.startsWith('http://tv.example:8080')));
});
test('Xtream episode requests restrict actions and stream IDs',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'provider:one',type:'xtream',name:'TV',server:'https://tv.example',
  username:'demo',password:'fixture',connection_mode:'browser-https'
 }]})]]);
 const called=[];
 const context={URL,URLSearchParams,Math,JSON,Date,console,AbortController,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},setTimeout,clearTimeout,
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async u=>{called.push(u);return{ok:true,text:async()=>JSON.stringify({episodes:{}})}}};
 vm.createContext(context);vm.runInContext(script,context);
 await assert.rejects(vm.runInContext("LumaIPTV.xtreamById('provider:one','any_private_url')",context),/Unsupported/);
 await assert.rejects(vm.runInContext("LumaIPTV.xtreamById('provider:one','get_series_info',{series_id:'../../private'})",context),/Invalid/);
 assert.equal(called.length,0);
 assert.equal(vm.runInContext("LumaIPTV.xtreamStreamURL('provider:one','movie',24,'mp4')",context),'https://tv.example/movie/demo/fixture/24.mp4');
 assert.equal(vm.runInContext("LumaIPTV.xtreamStreamURL('provider:one','movie','bad','mp4')",context),'');
});

test('native Luma offers automatic IPTV reconnection rather than file imports',()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'native:1',type:'xtream',name:'Demo',server:'http://tv.example:8080',
  username:'demo',password:'fixture',connection_mode:'native-direct'
 }]})]]);
 const screen={innerHTML:''};
 const context={URL,URLSearchParams,Math,JSON,Date,console,location:{protocol:'https:'},
  setTimeout,clearTimeout,document:{querySelector:s=>s==='#content'?screen:null,querySelectorAll:()=>[],activeElement:{id:''}},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  window:{LumaNativeIPTV:{fetchText:async()=>''}}};
 vm.createContext(context);vm.runInContext(script,context);
 vm.runInContext("LumaIPTV.render('guide')",context);
 assert.match(screen.innerHTML,/iptvQuickRetry/);
 assert.doesNotMatch(screen.innerHTML,/id="iptvRecoverImport"/);
 assert.doesNotMatch(screen.innerHTML,/id="iptvRecoverGuide"/);
});


test('EPG extraction examines late current programmes instead of cutting off first 28,000 entries',()=>{
 assert.doesNotMatch(script,/getElementsByTagName\("programme"\)\]\.slice\(0,28000\)/);
 assert.match(script,/const entries=doc\.getElementsByTagName\("programme"\)/);
 assert.match(script,/results\.length>=80000/);
 assert.match(script,/byGuideFolded/);
});

test('browser probes saved HTTP Xtream on its same HTTPS hostname without file imports',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'saved:auto',type:'xtream',name:'Example TV',server:'http://tv.example:8080',
  username:'demo',password:'fixture',connection_mode:'device-import'
 }]})]]);
 const calls=[],m3u='#EXTM3U\n#EXTINF:-1 tvg-id="news",News\nhttps://cdn.example/news.m3u8';
 const ctx={URL,URLSearchParams,Math,JSON,Date,console,AbortController,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},setTimeout,clearTimeout,
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{calls.push(String(url));return{ok:true,text:async()=>String(url).includes('xmltv.php')?'<?xml version="1.0"?><tv/>':m3u}}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 await vm.runInContext('LumaIPTV.loadGuide()',ctx);
 for(let i=0;i<10&&!vm.runInContext('LumaIPTV.channels().length',ctx);i++)
  await new Promise(res=>setTimeout(res,0));
 assert.equal(vm.runInContext('LumaIPTV.channels().length',ctx),1);
 assert.ok(calls.length>0);
 assert.ok(calls.every(url=>url.startsWith('https://tv.example/')));
 assert.equal(JSON.parse(saved.get('luma.iptv.v1')).browserSources[0].server,'http://tv.example:8080');
 assert.equal(JSON.parse(saved.get('luma.iptv.v1')).browserSources[0].connection_mode,'browser-https');
});

test('M3U parser accepts UTF-8 BOM and detects channel entries',()=>{
 const x=setup();
 const value=String.fromCharCode(65279)+'#EXTM3U\n#EXTINF:-1 tvg-id="tv.one",Channel One\nhttps://provider.example/live/ch1.m3u8';
 const rows=x.eval("LumaIPTV.parseM3U("+JSON.stringify(value)+")");
 assert.equal(rows.length,1);
 assert.equal(rows[0].name,'Channel One');
});
test('parallel IPTV loading retains a working provider when another service fails',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[
 {id:'good',type:'m3u',name:'Working IPTV',m3u_url:'https://working.example/list.m3u',connection_mode:'browser-https'},
 {id:'bad',type:'m3u',name:'Offline IPTV',m3u_url:'https://offline.example/list.m3u',connection_mode:'browser-https'}
 ]})]]);
 const visited=[],ctx={URL,URLSearchParams,Math,JSON,Date,console,setTimeout,clearTimeout,
  AbortController,location:{protocol:'https:'},document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async url=>{visited.push(String(url));
    if(String(url).startsWith('https://offline.example'))throw Error('offline');
    return{ok:true,text:async()=>"#EXTM3U\n#EXTINF:-1 tvg-id=\"one\",One Channel\nhttps://media.example/one.m3u8"};
  }};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 await vm.runInContext('LumaIPTV.loadGuide()',ctx);
 assert.equal(vm.runInContext('LumaIPTV.channels().length',ctx),1);
 assert.equal(vm.runInContext('LumaIPTV.channels()[0].provider',ctx),'Working IPTV');
 assert.ok(visited.some(url=>url.includes('working.example')));
 assert.ok(visited.some(url=>url.includes('offline.example')));
});
test('Xtream live category IDs map to provider category names',async()=>{
 const data={get_live_streams:[{stream_id:12,name:'News HD',category_id:'7',epg_channel_id:'news.us'}],
  get_live_categories:[{category_id:'7',category_name:'News & Information'}]};
 const store=new Map();
 const ctx={URL,URLSearchParams,Math,JSON,Date,console,AbortController,setTimeout,clearTimeout,
  location:{protocol:'https:'},document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},
  fetch:async input=>{const action=new URL(String(input)).searchParams.get('action');
   if(!action)return{ok:true,text:async()=>'<?xml version="1.0"?><tv></tv>'};
   return{ok:true,text:async()=>JSON.stringify(data[action]||[])};
  }};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 const result=await vm.runInContext('LumaIPTV.addProvider({type:"xtream",name:"My TV",server:"https://provider.example",username:"demo",password:"fixture"})',ctx);
 assert.equal(result.channels,1);
 assert.equal(vm.runInContext('LumaIPTV.channels()[0].group',ctx),'News & Information');
});


test('connection diagnostics are not duplicated as a full-page error on empty channel screens',()=>{
 assert.match(script,/displayMode==="home"/);
 assert.match(script,/channels\.length\s*\?\s*alert\+/);
 assert.match(script,/:\s*quickSetupHTML\(\)/);
 assert.match(script,/function quickSetupHTML\(\)/);
 assert.doesNotMatch(script,/function recoveryHTML\(\)/);
});


test('live TV guide presents watch and record controls without hiding original programme details',()=>{
 assert.match(script,/function guideSpotlight\(\)/);
 assert.match(script,/function guideQuickFilters\(groups\)/);
 assert.match(script,/data-guide-category/);
 assert.match(script,/data-iptv-quick-record/);
 assert.match(script,/data-program/);
 assert.match(script,/data-channel/);
 assert.match(script,/function quickRecord\(id\)/);
 assert.match(script,/LumaDeviceDVR\.schedule\(channel,programme\)/);
 assert.match(script,/recorder\("\/recordings","POST",\{program_id:programme.id\}\)/);
 assert.match(script,/No recording was started|no recording was started/);
 assert.match(html,/href="\.\/theater\.css"/);
});
test('recordings have separate upcoming, completed and series rule views',()=>{
 for(const term of ['data-dvr-tab','iptvDvrStats','iptvDvrEmpty','Recording manager','Series rules','Upcoming','Recorded'])
  assert.ok(script.includes(term),"missing "+term);
 assert.match(script,/dvrView=b\.dataset\.dvrTab/);
});
test('guide and recording buttons preserve local device and connected DVR paths',()=>{
 assert.match(script,/LumaDeviceDVR\.available\(\)/);
 assert.match(script,/connected&&!String\(programme.id\)\.startsWith\("local:"\)/);
 assert.match(script,/function recordingHTML\(\)/);
 assert.match(script,/function guideHTML\(\)/);
});


test('Xtream API short EPG fills a guide when XMLTV is unavailable',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'provider:one',type:'xtream',name:'Test IPTV',
  server:'http://tv.example:8080',username:'demo',password:'fixture',
  connection_mode:'device-import'
 }]})]]);
 const calls=[],ts=Math.floor(Date.now()/1000);
 const ctx={URL,URLSearchParams,Date,Math,JSON,console,AbortController,
  setTimeout,clearTimeout,atob:s=>Buffer.from(s,'base64').toString('binary'),TextDecoder,
  location:{protocol:'https:'},document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  window:{LumaNativeIPTV:{fetchText:async url=>{
   calls.push(String(url));
   if(String(url).includes('action=get_live_streams'))
    return JSON.stringify([{stream_id:123,name:'Test News',epg_channel_id:'news.example'}]);
   if(String(url).includes('action=get_live_categories'))return '[]';
   if(String(url).includes('action=get_short_epg'))return JSON.stringify({epg_listings:[{
    title:Buffer.from('Live News','utf8').toString('base64'),
    description:Buffer.from('Real guide synopsis','utf8').toString('base64'),
    start_timestamp:ts-600,stop_timestamp:ts+3000
   }]});
   if(String(url).includes('xmltv.php'))throw Error('Provider XMLTV unavailable');
   return '[]';
  }}}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 await vm.runInContext('LumaIPTV.loadGuide()',ctx);
 for(let i=0;i<30&&!vm.runInContext('LumaIPTV.programs().length',ctx);i++)
  await new Promise(resolve=>setImmediate(resolve));
 assert.equal(vm.runInContext('LumaIPTV.channels().length',ctx),1);
 const programme=vm.runInContext('LumaIPTV.programs()[0]',ctx);
 assert.ok(programme,'Xtream short EPG must populate programme information');
 assert.equal(programme.title,'Live News');
 assert.equal(programme.description,'Real guide synopsis');
 assert.equal(programme.guide_source,'Xtream short EPG');
 assert.equal(programme.is_new,false);
 assert.ok(calls.some(url=>url.includes('action=get_short_epg&stream_id=123')));
 assert.ok(calls.some(url=>url.includes('xmltv.php')));
 assert.ok(calls.every(url=>url.startsWith('http://tv.example:8080/')));
});
test('Xtream EPG API rejects channel path traversal before sending credentials',async()=>{
 const saved=new Map([['luma.iptv.v1',JSON.stringify({browserSources:[{
  id:'x',type:'xtream',server:'https://tv.example',username:'demo',password:'fixture'
 }]})]]);
 const calls=[];
 const ctx={URL,URLSearchParams,Date,Math,JSON,console,AbortController,
  setTimeout,clearTimeout,location:{protocol:'https:'},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  fetch:async u=>{calls.push(String(u));throw Error('No network call expected')}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 await assert.rejects(
  vm.runInContext('LumaIPTV.xtreamById("x","get_short_epg",{stream_id:"../123"})',ctx),
  /Invalid IPTV channel ID/
 );
 assert.equal(calls.length,0);
});
