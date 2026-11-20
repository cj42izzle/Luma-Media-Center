"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const file=p=>fs.readFileSync(p,"utf8"),source=file("tv.js"),css=file("styles.css"),html=file("index.html");
function harness({tv=false,native=false,narrow=false}={}){
 const listeners={};const windowListeners={};const states=new Set();
 const body={classList:{add:s=>states.add(s),remove:s=>states.delete(s),contains:s=>states.has(s)}};
 const doc={body,documentElement:{dataset:{tv:tv?"true":"false",lumaNative:native?"android-tv":""}},activeElement:null};
 function element(){
  const events={},attrs={};return {events,attrs,tagName:"BUTTON",addEventListener:(n,fn)=>{events[n]=fn},
   setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]},
   focus(){doc.activeElement=this},getClientRects:()=>[{}]};
 }
 const toggle=element(),side=element(),nav=element(),dismiss=element(),backdrop=element(),button=element();
 doc.activeElement=toggle;
 side.contains=x=>[side,nav,dismiss,button].includes(x);
 nav.querySelector=()=>button;
 doc.querySelector=s=>s===".sidebar"?side:null;
 doc.getElementById=s=>({navigation:nav,menuToggle:toggle,sidebarDismiss:dismiss,navBackdrop:backdrop})[s]||null;
 doc.addEventListener=(n,fn)=>{listeners[n]=fn};
 doc.contains=()=>true;
 const win={LumaNativePlatform:native?"android-tv":undefined,addEventListener:(n,fn)=>{windowListeners[n]=fn},
  matchMedia:query=>({matches:query.includes("max-width")?narrow:!narrow,addEventListener(){},addListener(){}})};
 vm.runInNewContext(source,{document:doc,window:win,getComputedStyle:()=>({visibility:"visible"})});
 return {doc,win,body,states,toggle,side,nav,dismiss,backdrop,button,listeners,windowListeners};
}
function key(h,name){let prevented=false;h.listeners.keydown({key:name,preventDefault(){prevented=true}});return prevented}
test("TV layout overlays instead of reserving a column",()=>{
 assert.match(css,/\[data-tv="true"\] \.app\{display:block!important/);
 assert.match(css,/\[data-tv="true"\] \.sidebar\{display:flex!important;.*position:fixed!important/);
 assert.match(css,/\[data-tv="true"\] body\.nav-open \.sidebar\{transform:translateX\(0\)!important/);
 assert.match(css,/\[data-tv="true"\] #menuToggle/);
 assert.doesNotMatch(css,/\[data-tv="true"\] \.app\{display:grid!important/);
});
test("TV drawer starts hidden, opens by remote select and closes with Back/Escape",()=>{
 const h=harness({tv:true});
 assert.equal(h.body.classList.contains("nav-open"),false);assert.equal(h.side.attrs["aria-hidden"],"true");
 assert.ok(Object.hasOwn(h.side.attrs,"inert"));
 h.toggle.events.click();assert.equal(h.body.classList.contains("nav-open"),true);
 assert.equal(h.side.attrs["aria-hidden"],"false");assert.equal(h.doc.activeElement,h.button);
 assert.equal(key(h,"Escape"),true);assert.equal(h.body.classList.contains("nav-open"),false);
 assert.equal(h.doc.activeElement,h.toggle);assert.ok(Object.hasOwn(h.side.attrs,"inert"));
});
test("TV selection closes sidebar and leaves focus on visible menu button",()=>{
 const h=harness({tv:true});h.toggle.events.click();
 h.nav.events.click({target:{closest:()=>h.button}});
 assert.equal(h.body.classList.contains("nav-open"),false);assert.equal(h.doc.activeElement,h.toggle);
 h.toggle.events.click();assert.equal(key(h,"ArrowRight"),true);
 assert.equal(h.body.classList.contains("nav-open"),false);
});
test("TV Menu remote key toggles navigation",()=>{
 const h=harness({tv:true});assert.equal(key(h,"Menu"),true);
 assert.equal(h.body.classList.contains("nav-open"),true);
 assert.equal(key(h,"ContextMenu"),true);assert.equal(h.body.classList.contains("nav-open"),false);
});
test("native Android TV bridge switches from desktop mode after the page loads",()=>{
 const h=harness();assert.equal(h.doc.documentElement.dataset.tv,"false");
 h.doc.documentElement.dataset.lumaNative="android-tv";h.win.LumaNativePlatform="android-tv";
 h.windowListeners["luma-native-iptv-ready"]();
 assert.equal(h.doc.documentElement.dataset.tv,"true");
 assert.ok(Object.hasOwn(h.side.attrs,"inert"));h.toggle.events.click();
 assert.equal(h.body.classList.contains("nav-open"),true);
 h.listeners.focusin({target:h.toggle});assert.equal(h.body.classList.contains("nav-open"),false);
});
test("normal desktop sidebar remains available while mobile uses a drawer",()=>{
 const desktop=harness();assert.equal(Object.hasOwn(desktop.side.attrs,"inert"),false);
 desktop.toggle.events.click();assert.equal(desktop.body.classList.contains("nav-open"),false);
 const mobile=harness({narrow:true});assert.ok(Object.hasOwn(mobile.side.attrs,"inert"));
 mobile.toggle.events.click();assert.equal(mobile.body.classList.contains("nav-open"),true);
});
test("Android TV source, standalone page and native detection stay in sync",()=>{
 assert.ok(html.includes(source.trim()));
 assert.ok(html.includes("/* TV navigation uses an off-canvas drawer"));
 assert.match(file("app.js"),/window\.LumaNativePlatform==="android-tv"/);
 assert.ok(html.includes('document.documentElement.dataset.lumaNative==="android-tv"'));
});
