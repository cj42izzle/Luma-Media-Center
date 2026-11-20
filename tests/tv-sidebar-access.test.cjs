"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const source=fs.readFileSync("tv.js","utf8"),html=fs.readFileSync("index.html","utf8"),css=fs.readFileSync("styles.css","utf8");
function harness(){
 const events={},controls=[],drawer=new Set(),windowEvents={},states=new Set();
 const doc={activeElement:null,documentElement:{dataset:{tv:"true",lumaNative:"android-tv"}}};
 const body={classList:{add:k=>states.add(k),remove:k=>states.delete(k),contains:k=>states.has(k)}};doc.body=body;
 const port={top:72,bottom:318},nav={scrollTop:0,events:{},addEventListener(k,v){this.events[k]=v},
  getBoundingClientRect(){return {top:port.top,bottom:port.bottom}}};
 function element(name,index=-1){
  const el={name,tagName:"BUTTON",events:{},attrs:{},hidden:false,disabled:false,
   addEventListener(k,v){this.events[k]=v},setAttribute(k,v){this.attrs[k]=v},
   removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]??null},
   getClientRects(){return [this.getBoundingClientRect()]},focus(){doc.activeElement=this},
   scrollIntoView(opts){this.lastScroll=opts},
   getBoundingClientRect(){const top=index<0?16:88+index*54-nav.scrollTop;
     return {left:15,top,width:175,height:45,right:190,bottom:top+45}},
   closest(){return null},classList:{contains:k=>k==="active"&&name==="Home"},
   click(){this.clicks=(this.clicks||0)+1;if(this.events.click)this.events.click()}};
  drawer.add(el);return el;
 }
 const quick=element("Settings shortcut"),dismiss=element("Close"),items=Array.from({length:20},(_,i)=>element(i===0?"Home":i===18?"More to explore":i===19?"Settings":"Menu "+i,i));
 items[18].tagName="SUMMARY";
 const settings=items[19];const toggle={events:{},addEventListener(k,v){this.events[k]=v},
  setAttribute(){},focus(){doc.activeElement=this}};
 nav.querySelector=q=>q.includes('data-tab="Settings"')?settings:items[0];
 nav.querySelectorAll=()=>items;
 nav.contains=el=>items.includes(el);
 const side={events:{},attrs:{},addEventListener(k,v){this.events[k]=v},
  setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},
  contains:el=>drawer.has(el),querySelectorAll:()=>[quick,dismiss,...items]};
 const backdrop={addEventListener(){}};
 doc.querySelector=s=>s===".sidebar"?side:null;
 doc.querySelectorAll=()=>[];
 doc.getElementById=s=>({navigation:nav,menuToggle:toggle,sidebarDismiss:dismiss,
  navBackdrop:backdrop,sidebarQuickSettings:quick})[s]||null;
 doc.addEventListener=(k,v)=>events[k]=v;doc.contains=()=>true;
 doc.activeElement=toggle;
 const win={LumaNativePlatform:"android-tv",innerHeight:360,
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  addEventListener:(k,v)=>{windowEvents[k]=v}};
 vm.runInNewContext(source,{document:doc,window:win,getComputedStyle:()=>({visibility:"visible"})});
 const press=key=>{let prevented=false;events.keydown({key,preventDefault(){prevented=true}});return prevented};
 return {doc,body,nav,side,items,quick,settings,press,open:()=>toggle.events.click()};
}
test("TV sidebar uses one scrollport and pinned Settings shortcut",()=>{
 assert.match(css,/\[data-tv="true"\] \.sidebar\{overflow-y:hidden!important/);
 assert.match(css,/\[data-tv="true"\] \.sidebar \.navigation\{display:flex!important;[\s\S]*overflow-y:auto!important/);
 assert.match(html,/id="sidebarQuickSettings"/);
 assert.match(html,/<style id="luma-tv-sidebar-access">/);
});
test("remote Down reaches Settings after scrolling through the entire menu",()=>{
 const h=harness();h.open();
 assert.equal(h.doc.activeElement,h.items[0]);
 for(let i=1;i<h.items.length;i++){
  assert.equal(h.press("ArrowDown"),true,"D-pad must move to menu item "+i);
  assert.equal(h.doc.activeElement,h.items[i]);
 }
 assert.equal(h.doc.activeElement,h.settings);
 assert.ok(h.nav.scrollTop>0,"navigation scrollport must move to expose Settings");
 assert.ok(h.settings.lastScroll,"Settings item must be revealed");
 for(let i=h.items.length-2;i>=0;i--){
  assert.equal(h.press("ArrowUp"),true);
  assert.equal(h.doc.activeElement,h.items[i]);
 }
});
test("More to explore summary is included in D-pad focus order",()=>{
 const h=harness();h.open();for(let i=1;i<=18;i++)h.press("ArrowDown");
 assert.equal(h.doc.activeElement.tagName,"SUMMARY");
 assert.equal(h.press("ArrowDown"),true);assert.equal(h.doc.activeElement,h.settings);
});
test("Settings shortcut opens its nav destination and dismisses drawer",()=>{
 const h=harness();h.open();
 h.quick.events.click();
 assert.equal(h.settings.clicks,1);
 assert.equal(h.body.classList.contains("nav-open"),false);
});
test("remote Back still closes the drawer",()=>{
 const h=harness();h.open();
 assert.equal(h.press("Escape"),true);
 assert.equal(h.body.classList.contains("nav-open"),false);
});
test("standalone site bundles exact tested TV script",()=>{
 assert.ok(html.includes(source.trim()));
});
