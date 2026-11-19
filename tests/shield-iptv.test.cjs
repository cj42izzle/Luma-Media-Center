"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const file=path=>fs.readFileSync(path,"utf8");
const iptv=file("iptv.js"),html=file("index.html");
function harness(saved={}){
 const storage=new Map(Object.entries(saved).map(([key,value])=>[key,JSON.stringify(value)]));
 const events={},page={protocol:"https:",href:"https://cj42izzle.github.io/Luma-Media-Center/?tv=1&app=android"};
 const window={addEventListener:(name,callback)=>{events[name]=callback}};
 const context={URL,URLSearchParams,Math,Date,JSON,console,window,location:page,
   setTimeout,clearTimeout,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))}};
 vm.createContext(context);vm.runInContext(iptv,context);
 return {context,window,events,storage,eval:expr=>vm.runInContext(expr,context)};
}
test("Shield APK has its own launcher and native networking and explicitly refreshes the current site",()=>{
 const app=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/TvActivity.java");
 const manifest=file("android-tv/app/src/main/AndroidManifest.xml");
 const build=file("android-tv/app/build.gradle");
 assert.match(manifest,/android.intent.category.LEANBACK_LAUNCHER/);
 assert.match(manifest,/android.permission.INTERNET/);
 assert.match(app,/WebSettings.LOAD_NO_CACHE/);
 assert.match(app,/luma-native-iptv-ready/);
 assert.match(app,/LumaNativeIPTVBridge/);
 assert.match(app,/window.LumaNativePlatform='android-tv'/);
 assert.match(build,/versionCode 7/);
 assert.match(html,/Install actual Android TV APK/);
 assert.match(html,/id="lumaAndroidBadge"/);
 assert.match(html,/id="lumaAndroidRefresh"/);
 assert.match(file("install.html"),/Luma-AndroidTV-Preview\.apk/);
});
test("native Android bridge queues simultaneous provider requests rather than dropping every request after three",()=>{
 const reader=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativeIPTVBridge.java");
 assert.match(reader,/new ThreadPoolExecutor\(/);
 assert.match(reader,/new LinkedBlockingQueue<>\(36\)/);
 assert.match(reader,/worker.execute\(/);
 assert.doesNotMatch(reader,/if\(!inFlight\.tryAcquire\(\)\)/);
});
test("browser-only and native platform messages remain universal",()=>{
 assert.doesNotMatch(file("iptv-portal.js"),/HTTP IPTV · iPhone mode/);
 assert.doesNotMatch(iptv,/Needs native iPhone app|Saved in Safari · Native connection required/);
 assert.match(iptv,/NVIDIA Shield/);
 assert.match(iptv,/Android TV/);
 assert.match(iptv,/iPhone/);
});
test("more than 9,000 live channels from a genuine provider feed are retained rather than silently clipped",()=>{
 const h=harness();
 const body="#EXTM3U\n"+Array.from({length:10020},(_,i)=>
  '#EXTINF:-1 tvg-id="ch'+i+'" group-title="Live TV",Live Channel '+i+'\nhttp://media.example/stream/'+i+'.ts').join("\n");
 h.context.fixture=body;
 const rows=h.eval("LumaIPTV.parseM3U(fixture)");
 assert.equal(rows.length,10020);
 assert.equal(rows[10019].epg_id,"ch10019");
 assert.match(iptv,/20,000-channel safety limit/);
});
test("saved HTTP IPTV source reloads when the installed Android native bridge becomes ready",async()=>{
 const saved={"luma.iptv.v1":{browserSources:[{id:"test:demo",type:"m3u",name:"Test IPTV",
  m3u_url:"http://media.example/playlist.m3u",connection_mode:"device-import"}]}};
 const h=harness(saved);
 assert.equal(h.eval("LumaIPTV.awaitingAndroidBridge()"),true);
 assert.equal(h.eval("LumaIPTV.nativeAvailable()"),false);
 assert.equal(typeof h.events["luma-native-iptv-ready"],"function");
 const playlist='#EXTM3U\n#EXTINF:-1 tvg-id="c1" group-title="News",First News\nhttp://media.example/channel1.ts\n'
  +'#EXTINF:-1 tvg-id="c2" group-title="Sports",Second Sports\nhttp://media.example/channel2.ts';
 let reads=0;
 h.window.LumaNativeIPTV={fetchText:async url=>{assert.equal(url,"http://media.example/playlist.m3u");reads++;return playlist}};
 h.events["luma-native-iptv-ready"]();
 for(let i=0;i<20&&h.eval("LumaIPTV.channels().length")===0;i++)
  await new Promise(resolve=>setTimeout(resolve,10));
 const rows=h.eval("LumaIPTV.channels()");
 assert.equal(rows.length,2);
 assert.equal(rows[0].provider,"Test IPTV");
 assert.equal(rows[1].group,"Sports");
 assert.equal(reads,1,"native bootstrap should avoid duplicate source fetches");
});
test("the standalone served app contains exact current IPTV module",()=>{
 assert.ok(html.includes(iptv.trim()));
});

test("native update path includes version gating, checksum validation, trusted downloads and Android approval",()=>{
 const java=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativeUpdateManager.java");
 const manifest=file("android-tv/app/src/main/AndroidManifest.xml");
 const paths=file("android-tv/app/src/main/res/xml/native_update_paths.xml");
 const workflow=file(".github/workflows/android-tv-apk.yml");
 const tv=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/TvActivity.java");
 for(const expected of [
  "Luma-AndroidTV-Update.json",
  "release.versionCode <= installedVersionCode()",
  'MessageDigest.getInstance("SHA-256")',
  "release.sha256.equals(hash.toString())",
  "!APK_URL.equals(url)",
  "Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES",
  "Intent.FLAG_GRANT_READ_URI_PERMISSION",
  "launchInstaller"
 ])assert.ok(java.includes(expected),"Missing native update protection: "+expected);
 assert.ok(manifest.includes("android.permission.REQUEST_INSTALL_PACKAGES"));
 assert.ok(manifest.includes("androidx.core.content.FileProvider"));
 assert.ok(manifest.includes("applicationId}.updates"));
 assert.ok(paths.includes('<cache-path name="luma_updater_apks" path="updates/" />'));
 assert.ok(tv.includes("LumaNativeUpdates"));
 assert.ok(html.includes('id="lumaAndroidUpdate"'));
 for(const expected of ["dist/Luma-AndroidTV-Update.json","size_bytes","sha256"])
  assert.ok(workflow.includes(expected),"Missing release metadata: "+expected);
});
test("connection audit reports actual source counts and refresh bypasses cached channel lists",async()=>{
 const saved={"luma.iptv.v1":{browserSources:[{
  id:"shield:provider",type:"m3u",name:"Shield Provider",
  m3u_url:"http://tv.example/playlist.m3u",connection_mode:"device-import"
 }]}};
 const h=harness(saved);
 let calls=0;
 const playlist=count=>"#EXTM3U\n"+Array.from({length:count},(_,i)=>
  '#EXTINF:-1 tvg-id="ch'+i+'" group-title="News",Channel '+i+
  '\nhttp://tv.example/live/'+i+'.ts').join("\n");
 let contents=playlist(2);
 h.window.LumaNativeIPTV={fetchText:async()=>{calls++;return contents}};
 h.events["luma-native-iptv-ready"]();
 for(let i=0;i<40&&h.eval("LumaIPTV.channels().length")<2;i++)
  await new Promise(resolve=>setTimeout(resolve,10));
 const initial=h.eval("LumaIPTV.connectionAudit()");
 assert.equal(initial.channels,2);
 assert.equal(initial.programs,0,"Guide must not be fabricated");
 assert.equal(initial.sources.length,1);
 assert.equal(initial.sources[0].count,2);
 assert.equal(initial.channelsWithGuide,0);
 assert.equal(initial.guideCoverage,0);
 assert.equal(initial.transport,"Native IPTV reader");
 h.context.document={querySelector:()=>null};
 contents=playlist(3);
 await h.eval("LumaIPTV.loadGuide()");
 const final=h.eval("LumaIPTV.connectionAudit()");
 assert.equal(final.channels,3);
 assert.equal(final.sources[0].count,3);
 assert.ok(calls>=2,"A user refresh should bypass the short-lived provider cache");
});
test("native reader reports IPTV authentication/network errors without printing secret URLs",()=>{
 const java=file("android-tv/app/src/main/java/io/github/cj42izzle/luma/NativeIPTVBridge.java");
 assert.match(java,/code==401\|\|code==403/);
 assert.match(java,/code==404/);
 assert.match(java,/code==429/);
 assert.match(java,/SafeFeedError/);
 assert.doesNotMatch(java,/respond\(id,null,String\(error\)/);
 const module=file("iptv.js");
 assert.match(module,/function connectionAudit/);
 assert.match(module,/iptvAuditRetry/);
 assert.match(module,/fresh:!silent/);
});


test("iPhone owner setup runs without pasting and never commits a private signing key",()=>{
 const taskFile=JSON.parse(file(".vscode/tasks.json"));
 const tasks=taskFile.tasks||[];
 const task=tasks.find(x=>x.label.includes("One-time owner signing setup"));
 assert.ok(task,"A selectable VS Code owner setup task must exist");
 assert.equal(task.type,"shell");
 assert.equal(task.command,"bash");
 assert.deepEqual(Array.from(task.args),["android-tv/setup-signing.sh"]);
 assert.equal(task.group.isDefault,true);
 assert.equal(task.runOptions.runOn,"default");
 const setup=file("android-tv/setup-signing.sh");
 assert.match(setup,/gh auth login -h github.com --web --scopes repo/);
 assert.match(setup,/unset GH_TOKEN GITHUB_TOKEN/);
 assert.match(setup,/gh secret set --app actions/);
 assert.match(setup,/\.luma-private/);
 assert.match(setup,/BACKUP_SAVED|backup/);
 assert.match(file(".gitignore"),/\.luma-private\//);
 assert.match(file("android-tv/SIGNING.md"),/Terminal → Run Task/);
});
