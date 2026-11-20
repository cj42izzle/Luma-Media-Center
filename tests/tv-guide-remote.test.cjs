"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const script=fs.readFileSync("tv.js","utf8");
function harness(){
 const events={},states=new Set();
 const doc={activeElement:null,documentElement:{dataset:{tv:"true",lumaNative:"android-tv"}}};
 const body={classList:{add:s=>states.add(s),remove:s=>states.delete(s),contains:s=>states.has(s)}};doc.body=body;
 const rect=(x,y)=>({left:x,top:y,right:x+130,bottom:y+52,width:130,height:52});
 const control=(name,key,x,y)=>{
  const r=rect(x,y);
  return {name,tagName:"BUTTON",attrs:{[key]:name},getAttribute(k){return this.attrs[k]},
   hasAttribute(k){return Object.hasOwn(this.attrs,k)},getClientRects(){return [r]},
   getBoundingClientRect(){return r},
   closest(k){return k===".iptvGuideRow"?this.row:null},focus(){doc.activeElement=this},
   scrollIntoView(){this.wasRevealed=true},setAttribute(k,v){this.attrs[k]=v},
   removeAttribute(k){delete this.attrs[k]},addEventListener(){},
   classList:{contains:()=>false}};
 };
 const ch1=control("channel1","data-channel",60,130),map1=control("map1","data-iptv-map",260,130);
 const ch2=control("channel2","data-channel",60,230),map2=control("map2","data-iptv-map",260,230);
 const row1={querySelectorAll:()=>[ch1,map1]},row2={querySelectorAll:()=>[ch2,map2]};
 const grid={querySelectorAll:s=>s===".iptvGuideRow"?[row1,row2]:[]};
 row1.parentElement=grid;row2.parentElement=grid;
 for(const el of [ch1,map1])el.row=row1;for(const el of [ch2,map2])el.row=row2;
 const side={setAttribute(){},removeAttribute(){},contains:()=>false};
 const nav={querySelector:()=>null,addEventListener(){}},toggle={setAttribute(){},addEventListener(){}},
  dismiss={addEventListener(){}},backdrop={addEventListener(){}};
 doc.activeElement=ch1;
 doc.querySelectorAll=()=>[];
 doc.querySelector=s=>s===".sidebar"?side:null;
 doc.getElementById=s=>({navigation:nav,menuToggle:toggle,sidebarDismiss:dismiss,navBackdrop:backdrop})[s]||null;
 doc.addEventListener=(name,fn)=>events[name]=fn;doc.contains=()=>true;
 const win={LumaNativePlatform:"android-tv",matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}};
 vm.runInNewContext(script,{window:win,document:doc,getComputedStyle:()=>({visibility:"visible"})});
 const press=key=>{let blocked=false;events.keydown({key,preventDefault(){blocked=true}});return blocked};
 return {doc,ch1,ch2,map1,map2,press};
}
test("D-pad moves down/up between stations without jumping to header",()=>{
 const h=harness();
 assert.equal(h.press("ArrowDown"),true);assert.equal(h.doc.activeElement,h.ch2);
 assert.equal(h.ch2.wasRevealed,true);
 assert.equal(h.press("ArrowUp"),true);assert.equal(h.doc.activeElement,h.ch1);
});
test("D-pad stays in EPG mapping column across rows",()=>{
 const h=harness();h.doc.activeElement=h.map1;
 assert.equal(h.press("ArrowDown"),true);assert.equal(h.doc.activeElement,h.map2);
 assert.equal(h.press("ArrowUp"),true);assert.equal(h.doc.activeElement,h.map1);
});
test("does not trap Up/Down when no adjacent guide row exists",()=>{
 const h=harness();h.doc.activeElement=h.ch2;
 assert.match(script,/if\(!adjacent\)return false/);
 assert.equal(h.press("ArrowDown"),false);
});
