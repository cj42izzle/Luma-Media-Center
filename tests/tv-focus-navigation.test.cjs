"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const script=fs.readFileSync("tv.js","utf8");
const html=fs.readFileSync("index.html","utf8");
function harness({tv=true,scrollY=0,height=700,scrollHeight=2400}={}){
 const events={},windowEvents={},scrollCalls=[],states=new Set(),nodes=[];
 const doc={activeElement:null,documentElement:{dataset:{tv:tv?"true":"false",lumaNative:tv?"android-tv":""},scrollHeight},scrollingElement:{scrollHeight,scrollTop:scrollY}};
 const body={classList:{add:n=>states.add(n),remove:n=>states.delete(n),contains:n=>states.has(n)},scrollHeight};
 doc.body=body;
 const bounds=(left,top,width=140,h=48)=>({left,top,right:left+width,bottom:top+h,width,height:h});
 const header={getBoundingClientRect:()=>bounds(0,0,1000,180)};
 const content={id:"content"},main={querySelectorAll:()=>nodes};
 const side={attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},
   contains:x=>x?.region==="drawer",querySelectorAll:()=>nodes.filter(x=>x.region==="drawer")};
 function element(name,tagName,left,top,width=140,h=48,region="content"){
   const el={name,tagName,region,rect:bounds(left,top,width,h),events:{},attrs:{},hidden:false,disabled:false,
    classList:{contains:n=>false},addEventListener(n,fn){this.events[n]=fn},
    setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},
    getAttribute(k){return this.attrs[k]??null},getClientRects(){return [this.rect]},
    getBoundingClientRect(){return this.rect},focus(){doc.activeElement=this},
    scrollIntoView(opts){this.lastScroll=opts},
    closest(selector){if(selector==="[inert],[aria-hidden=\"true\"]")return this.hidden?{}:null;
      if(selector==="#content")return this.region==="content"?content:null;
      if(selector===".top")return this.region==="header"?header:null;
      return null},
    matches(){return false}};
   nodes.push(el);return el;
 }
 const toggle=element("menu","BUTTON",40,20,100,48,"header"),dismiss=element("dismiss","BUTTON",20,10,100,48,"drawer"),
   drawerButton=element("drawer-home","BUTTON",20,90,170,48,"drawer");
 const nav={addEventListener(n,fn){this.events??={};this.events[n]=fn},querySelector:()=>drawerButton};
 const backdrop={addEventListener(n,fn){this.events??={};this.events[n]=fn}};
 const search=element("search","INPUT",435,120,380,54,"header");
 search.type="search";
 side.contains=x=>x===dismiss||x===drawerButton;
 const mainRoot={querySelectorAll:()=>nodes.filter(x=>x.region!=="drawer")};
 doc.querySelector=s=>s===".sidebar"?side:s===".main"?mainRoot:s===".top"?header:null;
 doc.getElementById=s=>({navigation:nav,menuToggle:toggle,sidebarDismiss:dismiss,navBackdrop:backdrop})[s]||null;
 doc.querySelectorAll=()=>nodes;
 doc.addEventListener=(n,fn)=>{events[n]=fn};
 doc.contains=()=>true;
 doc.activeElement=toggle;
 const win={LumaNativePlatform:tv?"android-tv":undefined,innerHeight:height,scrollY,scrollBy:x=>scrollCalls.push(x),
  matchMedia:q=>({matches:q.includes("min-width")?true:false,addEventListener(){},addListener(){}}),
  addEventListener:(n,fn)=>{windowEvents[n]=fn}};
 vm.runInNewContext(script,{document:doc,window:win,getComputedStyle:()=>({visibility:"visible"})});
 return {doc,win,events,scrollCalls,search,toggle,element,main,side,nodes};
}
function press(h,key){let prevented=false;h.events.keydown({key,preventDefault(){prevented=true}});return prevented}
test("Android TV Up/Down escapes search and returns to results",()=>{
 const h=harness();const hero=h.element("hero","BUTTON",480,285,180,48);
 h.doc.activeElement=h.search;
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,hero);
 assert.equal(press(h,"ArrowUp"),true);assert.equal(h.doc.activeElement,h.search);
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,hero);
});
test("Up from search reaches the header and Down returns to search",()=>{
 const h=harness();const refresh=h.element("refresh","BUTTON",530,48,140,42,"header");
 h.doc.activeElement=h.search;
 assert.equal(press(h,"ArrowUp"),true);assert.equal(h.doc.activeElement,refresh);
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,h.search);
 assert.equal(press(h,"ArrowLeft"),false);assert.equal(h.doc.activeElement,h.search);
});
test("Down and Up work through multiple page rows including beyond screen",()=>{
 const h=harness();
 const row1=h.element("row1","BUTTON",500,300,140,70);
 const row2=h.element("row2","BUTTON",510,630,140,70);
 const row3=h.element("row3","BUTTON",520,970,140,70);
 h.doc.activeElement=row1;
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,row2);
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,row3);
 assert.equal(row3.lastScroll.block,"nearest");
 assert.equal(press(h,"ArrowUp"),true);assert.equal(h.doc.activeElement,row2);
});
test("sticky search does not steal Up from content when an earlier content row exists",()=>{
 const h=harness();
 const earlier=h.element("earlier","BUTTON",50,460,120,55);
 const current=h.element("current","BUTTON",520,820,120,55);
 h.doc.activeElement=current;
 assert.equal(press(h,"ArrowUp"),true);
 assert.equal(h.doc.activeElement,earlier);
});
test("return to search when at the first content control",()=>{
 const h=harness();const first=h.element("first","BUTTON",480,320,180,60);
 h.doc.activeElement=first;
 assert.equal(press(h,"ArrowUp"),true);assert.equal(h.doc.activeElement,h.search);
});
test("rerender focus loss resumes in the current viewport instead of Menu",()=>{
 const h=harness();h.element("offscreen","BUTTON",530,1250,120,55);
 const upper=h.element("upper","BUTTON",480,300,120,50);
 const lower=h.element("lower","BUTTON",490,520,120,50);
 h.doc.activeElement=h.doc.body;
 assert.equal(press(h,"ArrowUp"),true);assert.equal(h.doc.activeElement,lower);
 h.doc.activeElement=h.doc.body;
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,upper);
});
test("TV text input keeps left/right cursor editing, but can exit vertically",()=>{
 const h=harness();const catalog=h.element("catalog-filter","INPUT",200,310,180,46);
 const results=h.element("results","BUTTON",210,520,180,48);
 catalog.type="search";h.doc.activeElement=catalog;
 assert.equal(press(h,"ArrowRight"),false);assert.equal(h.doc.activeElement,catalog);
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,results);
});
test("sparse page scrolls when no next focusable exists",()=>{
 const h=harness({scrollY:100,height:700,scrollHeight:2400});
 const last=h.element("last","BUTTON",510,590,160,55);
 h.doc.activeElement=last;
 assert.equal(press(h,"ArrowDown"),true);
 assert.equal(h.doc.activeElement,last);
 assert.equal(h.scrollCalls.length,1);
 assert.ok(h.scrollCalls[0].top>0);
});
test("desktop browser does not intercept arrows from text input",()=>{
 const h=harness({tv:false});h.element("results","BUTTON",480,300,160,48);
 h.doc.activeElement=h.search;
 assert.equal(press(h,"ArrowDown"),false);assert.equal(h.doc.activeElement,h.search);
});
test("hidden and disabled controls are skipped",()=>{
 const h=harness();const hidden=h.element("hidden","BUTTON",480,235,160,48);
 hidden.hidden=true;
 const disabled=h.element("disabled","BUTTON",480,275,160,48);
 disabled.disabled=true;
 const visible=h.element("visible","BUTTON",480,380,160,48);
 h.doc.activeElement=h.search;
 assert.equal(press(h,"ArrowDown"),true);assert.equal(h.doc.activeElement,visible);
});
test("live standalone page includes the exact tested TV navigation source",()=>{
 assert.ok(html.includes(script.trim()));
 assert.match(script,/Android TV must be able to leave text fields/);
});
