"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const rawApp=fs.readFileSync("app.js","utf8");
const app=rawApp.replace("discover();LumaCalendar.prime().catch(()=>{});","LumaCalendar.prime().catch(()=>{});");
if(app===rawApp)throw Error("The app test bootstrap changed; update profile tests.");
function harness(initial={}){
 const data=new Map(Object.entries(initial)),nodes=new Map();
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{innerHTML:"",textContent:"",value:"",dataset:{},
   style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},
   setAttribute(){},addEventListener(){},focus(){},querySelector(){return null},getAttribute(){return null}});
  return nodes.get(selector);
 };
 const localStorage={getItem:key=>data.get(key)||null,setItem:(key,v)=>data.set(key,String(v)),
  removeItem:key=>data.delete(key)};
 const document={querySelector:node,querySelectorAll:()=>[],activeElement:null,
  documentElement:{style:{setProperty(){}},dataset:{}},body:{classList:{add(){},remove(){}},dataset:{}},
  addEventListener(){}};
 const ctx={document,localStorage,window:{addEventListener(){},scrollTo(){}},
  location:{origin:"https://example.test",search:"",pathname:"/Luma-Media-Center/"},navigator:{},
  LumaReleases:{all:()=>[],label:()=>"",bind(){},refresh:async()=>{},enrichDetail(){}},
  LumaCalendar:{prime:async()=>{},bindHome(){},registerFollow(){}},
  LumaAddons:{render(){},installed:()=>false},
  LumaCollections:{collectionID:()=>"",providerShowcase:()=>"",renderCollection:()=>"",
   bind(){},find(){return null},open(){}},
  LumaPeople:{markup:()=>"",bind(){}},
  LumaAccounts:{deviceItems:()=>[],watchlistMarkup:()=>"",watchlistBind(){},choose(){}},
  AbortController,URL,URLSearchParams,setTimeout,clearTimeout,console,scrollTo(){},confirm:()=>true};
 vm.createContext(ctx);vm.runInContext(app,ctx);
 return {run:s=>vm.runInContext(s,ctx),data,node};
}
test("legacy watchlist, favorites, history and progress remain in the default viewer",()=>{
 const h=harness({
  "luma.v2.profile":JSON.stringify("Original viewer"),
  "luma.v2.watch":JSON.stringify(["show:1"]),
  "luma.v2.favorites":JSON.stringify(["movie:1"]),
  "luma.v2.watched":JSON.stringify(["show:1:s1e1"]),
  "luma.v2.progress":JSON.stringify({"show:1:s1e2":{fraction:0.5,seconds:900,updated:10}})
 });
 assert.equal(h.run("state.profile"),"Original viewer");
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["show:1"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),["movie:1"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watched)")),["show:1:s1e1"]);
 assert.equal(h.run('state.progress["show:1:s1e2"].seconds'),900);
 assert.equal(h.run("profileRegistry.activeId"),"default");
});
test("viewer switching isolates watchlist, favorites, watched episodes, links and resume history",()=>{
 const h=harness({"luma.v2.watch":JSON.stringify(["legacy"])});
 assert.equal(h.run('createViewer("Alex")'),true);
 assert.equal(h.run("state.profile"),"Alex");
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),[]);
 const id=h.run("profileRegistry.activeId");
 assert.ok(id.startsWith("viewer-"));
 h.run('state.watch=["alex-show"];save("watch",state.watch);state.favorites=["alex-fav"];save("favorites",state.favorites)');
 h.run('state.watched=["alex-show:s1e2"];save("watched",state.watched)');
 h.run('state.progress={"alex-show:s1e3":{seconds:350,fraction:0.31,updated:10}};save("progress",state.progress)');
 h.run('state.links={"alex-show":{url:"https://example.test/a.mp4"}};save("links",state.links)');
 assert.equal(h.run('switchViewer("default")'),true);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["legacy"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),[]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watched)")),[]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.progress)")),{});
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.links)")),{});
 assert.equal(h.run('switchViewer(profileRegistry.entries[1].id)'),true);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["alex-show"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.favorites)")),["alex-fav"]);
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watched)")),["alex-show:s1e2"]);
 assert.equal(h.run('state.progress["alex-show:s1e3"].seconds'),350);
 assert.equal(h.run('state.links["alex-show"].url'),"https://example.test/a.mp4");
 assert.equal(h.data.get("luma.v2.watch"),JSON.stringify(["legacy"]));
 const reloaded=harness(Object.fromEntries(h.data));
 assert.equal(reloaded.run("state.profile"),"Alex");
 assert.deepEqual(JSON.parse(reloaded.run("JSON.stringify(state.watched)")),["alex-show:s1e2"]);
});
test("viewer management protects default history and removes only deleted viewer data",()=>{
 const h=harness({"luma.v2.watch":JSON.stringify(["legacy"])});
 h.run('createViewer("Alex")');
 const id=h.run("profileRegistry.activeId");
 assert.equal(h.run('renameViewer(profileRegistry.activeId,"Alex Two")'),true);
 assert.equal(h.run("state.profile"),"Alex Two");
 assert.equal(h.run('createViewer("Alex Two")'),false);
 assert.equal(h.run('deleteViewer("default")'),false);
 h.run('state.watch=["alex"];save("watch",state.watch)');
 assert.equal(h.run("deleteViewer(profileRegistry.entries[1].id)"),true);
 assert.equal(h.run("profileRegistry.activeId"),"default");
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(state.watch)")),["legacy"]);
 assert.equal(h.data.get("luma.v2.watch"),JSON.stringify(["legacy"]));
 assert.equal(h.data.has("luma.v2.viewer.v1."+id+".watch"),false);
 assert.equal(h.run("profileRegistry.entries.length"),1);
});
test("recommendations and excluded watched titles are profile-specific",()=>{
 const h=harness();
 h.run('state.items=[{id:"show1",title:"Loved Series",type:"Series",year:"2024",poster:"https://example.test/one.jpg",genreNames:["Drama"]},{id:"show2",title:"Related Series",type:"Series",year:"2025",poster:"https://example.test/two.jpg",genreNames:["Drama"]}]');
 h.run('state.favorites=["show1"];save("favorites",state.favorites)');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))")),["show2"]);
 h.run('state.watched=["show2"];save("watched",state.watched)');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))")),[]);
 h.run('createViewer("Taylor")');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))")),[]);
 h.run('state.favorites=["show2"];save("favorites",state.favorites)');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))")),["show1"]);
 h.run('switchViewer("default")');
 assert.deepEqual(JSON.parse(h.run("JSON.stringify(suggestedTitles(state.items).map(x=>x.id))")),[]);
});
test("profile controls and navigation are available to phones and Android TV",()=>{
 const h=harness();
 const page=h.run("profilesMarkup()");
 assert.match(page,/Who is watching\?/);
 assert.match(page,/data-profile-switch="default"/);
 assert.match(page,/id="createProfileForm"/);
 assert.match(page,/profileCards/);
 assert.match(rawApp,/state.tab==="Profiles"/);
 const html=fs.readFileSync("index.html","utf8");
 assert.match(html,/id="lumaProfileQuick"/);
 assert.match(html,/profiles\.css/);
 const phone=fs.readFileSync("mobile-nav.js","utf8");
 assert.match(phone,/\["Profiles","Viewer Profiles"\]/);
 const tv=fs.readFileSync("tv-experience.js","utf8");
 assert.match(tv,/id="lumaTvProfile"/);
 const tvos=fs.readFileSync("tvos/LumaTV/App.swift","utf8");
 assert.match(tvos,/profiles\.tabItem/);
 assert.match(fs.readFileSync("tvos/LumaTV/Catalog.swift","utf8"),/activeViewerID/);
});
