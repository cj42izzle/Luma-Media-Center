"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
const tvCSS=fs.readFileSync("tv-experience.css","utf8"),tvJS=fs.readFileSync("tv-experience.js","utf8");
const start=app.indexOf("function syncHeaderSearch(){"),end=app.indexOf("function toast(msg)",start);
assert.ok(start>0&&end>start,"Find shared header search and paint implementations");
const searchAndPaint=app.slice(start,end);
function setup({native=false,query="",mobile=false,tab="Home"}={}){
 const attributes={};
 const wrap={hidden:false,inert:false,classes:new Set(),classList:{toggle(){}},setAttribute(k,v){attributes["wrap:"+k]=v}};
 wrap.classList.toggle=(k,value)=>{if(value)wrap.classes.add(k);else wrap.classes.delete(k)};
 const input={disabled:false,tabIndex:0,focused:false,setAttribute(k,v){attributes["field:"+k]=v},blur(){this.blurred=true}};
 const sidebar={focus(){this.focused=true}};
 const els={".top .searchWrap":wrap,"#search":input,"#lumaTvSidebarSearch":sidebar};
 const document={documentElement:{style:{setProperty(){}},dataset:{}},activeElement:null,querySelector:key=>els[key]||null};
 const window={LumaNativePlatform:native?"android-tv":undefined,matchMedia:()=>({matches:mobile})};
 const state={tab,accent:"#ddd",theme:"dark",density:"comfortable"};
 const context=vm.createContext({$,document,window,state,location:{search:query},URLSearchParams});
 function $(selector){return els[selector]||null}
 vm.runInContext(searchAndPaint+"\npaint();",context);
 return {context,wrap,input,sidebar,document,window,attributes};
}
test("Android TV shell hides and disables global header search on every page",()=>{
 for(const tab of ["Home","Live TV","Guide","Catalogs","Movies","TV Shows","Anime","My Library","Settings"]){
  const {wrap,input,document,attributes}=setup({native:true,tab});
  assert.equal(document.documentElement.dataset.tv,"true");
  assert.equal(wrap.hidden,true,tab);
  assert.equal(wrap.inert,true,tab);
  assert.equal(input.disabled,true,tab);
  assert.equal(input.tabIndex,-1,tab);
  assert.equal(attributes["wrap:aria-hidden"],"true");
 }
});
test("TV web query and native late activation both hide duplicated search",()=>{
 const web=setup({query:"?tv=1",tab:"Guide"});
 assert.equal(web.wrap.hidden,true);
 const late=setup({tab:"Home"});
 assert.equal(late.wrap.hidden,false);
 late.document.activeElement=late.input;
 late.window.LumaNativePlatform="android-tv";
 vm.runInContext("paint()",late.context);
 assert.equal(late.wrap.hidden,true);
 assert.equal(late.input.disabled,true);
 assert.equal(late.sidebar.focused,true);
 assert.match(app,/luma-native-iptv-ready/);
});
test("phones show shared search only on the Search tab and desktop remains unchanged",()=>{
 const home=setup({mobile:true,tab:"Home"});
 const catalog=setup({mobile:true,tab:"Catalogs"});
 const movies=setup({mobile:true,tab:"Movies"});
 const desktop=setup({mobile:false,tab:"Home"});
 assert.equal(home.wrap.hidden,true);
 assert.equal(movies.wrap.hidden,true);
 assert.equal(catalog.wrap.hidden,false);
 assert.equal(catalog.input.disabled,false);
 assert.equal(catalog.input.tabIndex,0);
 assert.equal(desktop.wrap.hidden,false);
});
test("TV CSS and standalone critical styling hide the old top search even with stale external assets",()=>{
 assert.doesNotMatch(tvCSS,/\.top \.searchWrap\{flex:0 1 285px!important/);
 assert.doesNotMatch(tvCSS,/\.top \.searchWrap\{flex:0 1 210px!important/);
 assert.match(tvCSS,/html\[data-tv="true"\] header\.top \.searchWrap/);
 assert.match(html,/id="luma-tv-header-search-guard"/);
 assert.match(html,/tv-experience\.css\?v=4/);
 assert.match(html,/html\[data-luma-native="android-tv"\] header\.top \.searchWrap/);
 assert.match(tvJS,/id="lumaTvSidebarSearch"/);
 assert.match(tvJS,/if\(typeof onSearch==="function"\)onSearch\(value\)/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1].trim());
 assert.ok(scripts.includes(app.trim()),"Live standalone HTML must match the fix in app.js");
});
