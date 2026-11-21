"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("tv-experience.js","utf8"),css=fs.readFileSync("tv-experience.css","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8"),iptv=fs.readFileSync("iptv.js","utf8");
function fixture({channels=[],programs=[],items=[],watching=[],favorites=[],recent=[]}={}){
 const opened=[],details=[],buttons=[],programButtons=[],saved=new Map([
  ["luma.tv.recentChannels.v1",JSON.stringify(recent)]
 ]);
 const body={dataset:{}};
 const ctx={URL,Date,Math,JSON,document:{body,querySelectorAll:selector=>
    selector==="[data-tv-channel]"?buttons:selector==="[data-tv-program]"?programButtons:[]},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v))},
  LumaIPTV:{channels:()=>channels,programs:()=>programs,isFavorite:id=>favorites.includes(id),
   openChannel:id=>opened.push(id),openProgramme:id=>details.push(id)}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const model={items,watching};
 ctx.model=model;
 ctx.shelf=(title,list)=>'<section class="lumaShelf">'+title+" · "+list.length+"</section>";
 return {ctx,body,opened,details,buttons,programButtons,saved,
  markup:()=>vm.runInContext("LumaTVExperience.markup(model,shelf)",ctx)};
}
const channel=(id,name)=>({id,name,provider:"Demo IPTV",url:"http://media.example/"+id+".ts",group:"News"});
test("Android TV gets a DIRECTV-style vertical TV rail; ordinary mobile remains unchanged",()=>{
 assert.match(css,/#lumaTvNav\{display:none\}/);
 assert.match(css,/html\[data-tv="true"\] #lumaTvNav\{[\s\S]*position:fixed!important/);
 assert.match(css,/html\[data-tv="true"\] \.tvSpotlightArea/);
 assert.match(css,/html\[data-tv="true"\] \.tvChannelStrip/);
 assert.match(css,/html\[data-tv="true"\] body\[data-luma-tv-view="home"\] \.top\{display:none!important\}/);
 assert.doesNotMatch(css,/^\s*body\{background:/m);
 assert.match(css,/@media\(max-width:800px\)/);
 assert.match(html,/href="\.\/tv-experience\.css\?v=3"/);
 assert.match(html,/src="\.\/tv-experience\.js\?v=3"/);
});
test("Left navigation exposes TV destinations without rebuilding focused controls",()=>{
 const x=fixture();
 const buttons=["Home","Live TV","Guide","Movies","TV Shows","My Library","Recordings","Settings"].map(tab=>{
  const button={dataset:{tab},current:null,setAttribute(k,v){this[k]=v}};
  button.classList={toggle(k,v){if(k==="active")button.current=v}};
  return button;
 });
 const root={dataset:{},innerHTML:"",querySelectorAll:()=>buttons};
 x.ctx.root=root;x.ctx.active="Home";
 vm.runInContext("LumaTVExperience.nav(root,active)",x.ctx);
 assert.match(root.innerHTML,/class="tvNavRail"/);
 assert.match(root.innerHTML,/aria-label="Guide"/);
 assert.match(root.innerHTML,/id="lumaTvSearch"/);
 assert.match(root.innerHTML,/id="lumaTvMore"/);
 assert.equal(x.body.dataset.lumaTvView,"home");
 const first=root.innerHTML;x.ctx.active="Guide";
 vm.runInContext("LumaTVExperience.nav(root,active)",x.ctx);
 assert.equal(root.innerHTML,first);
 assert.equal(buttons[2].current,true);
 assert.equal(buttons[2]["aria-current"],"page");
 assert.equal(x.body.dataset.lumaTvView,"other");
});
test("TV Home matches the channel-ribbon, featured broadcast and content-row hierarchy",()=>{
 const x=fixture({channels:[channel("news","News One"),channel("sports","Sports HD")],watching:[{id:"w",title:"Saved episode"}]});
 const home=x.markup();
 assert.match(home,/data-tv-experience="true"/);
 assert.match(home,/Your TV <span>at /);
 assert.match(home,/class="tvChannelStrip"/);
 assert.match(home,/class="tvSpotlightArea"/);
 assert.match(home,/class="tvUpNext"/);
 assert.match(home,/Continue Watching/);
 assert.match(home,/class="tvBroadcastRail"/);
 assert.ok(home.indexOf('class="tvChannelStrip"')<home.indexOf('class="tvSpotlightArea"'));
 assert.ok(home.indexOf('class="tvSpotlightArea"')<home.indexOf("Continue Watching"));
 assert.match(home,/data-go="Guide"/);
});
test("Channel strip contains real usable stations, without duplicating or inventing names",()=>{
 const x=fixture({channels:[
  {...channel("a","NBC West"),logo:"https://img.example/nbc.png"},
  channel("b","News North"),channel("a","Duplicate station"),
  {id:"invalid",name:"Empty stream",url:""}],favorites:["a"]});
 const html=x.markup();
 assert.match(html,/NBC West/);
 assert.match(html,/News North/);
 assert.doesNotMatch(html,/data-tv-channel="invalid"/);
 assert.match(html,/2 IPTV channels loaded/);
 assert.match(html,/data-tv-channel="a"/);
 assert.match(html,/class="tvNetworkLogo"/);
});
test("Live feature uses verified EPG title, channel, times, and progress",()=>{
 const now=Date.now();
 const x=fixture({channels:[channel("a","Station Alpha")],programs:[
  {id:"show1",channel_id:"a",title:"Verified Live News",
   start:now-25*60000,end:now+35*60000,description:"Actual description from the guide",episode:"S01E02"}]});
 const home=x.markup();
 assert.match(home,/Verified Live News/);
 assert.match(home,/Actual description from the guide/);
 assert.match(home,/S01E02/);
 assert.match(home,/data-tv-program="show1"/);
 assert.match(home,/class="tvFeatureProgress"/);
 assert.match(home,/35 min left/);
 assert.match(home,/data-tv-channel="a"/);
 assert.match(home,/On Now/);
});
test("Upcoming programmes are source-backed and open their actual programme details",()=>{
 const now=Date.now();
 const x=fixture({channels:[channel("a","Network A"),channel("b","Network B")],programs:[
  {id:"now",channel_id:"a",title:"Currently Airing",start:now-120000,end:now+1800000},
  {id:"next",channel_id:"a",title:"Confirmed Later Show",start:now+2100000,end:now+3900000}]});
 const home=x.markup();
 assert.match(home,/Coming up on your TV/);
 assert.match(home,/Confirmed Later Show/);
 assert.match(home,/data-tv-program="next"/);
 assert.doesNotMatch(home,/Made up episode/);
});
test("Missing EPG shows honest schedule status instead of synthetic programme details",()=>{
 const home=fixture({channels:[channel("a","Missing Guide")]}).markup();
 assert.match(home,/Schedule unavailable/);
 assert.match(home,/class="tvLiveTile"/);
 assert.doesNotMatch(home,/class="tvFeatureProgress"/);
 assert.doesNotMatch(home,/data-tv-program=/);
});
test("Empty home offers provider setup without fake live channels",()=>{
 const home=fixture().markup();
 assert.match(home,/Your TV <span>at /);
 assert.match(home,/No IPTV channels connected yet/);
 assert.match(home,/Add your TV service/);
 assert.match(home,/data-go="Settings"/);
 assert.doesNotMatch(home,/data-tv-channel=/);
});
test("Movie artwork never masquerades as a different live programme",()=>{
 const now=Date.now(),p={id:"p",channel_id:"a",title:"Real News",start:now-60000,end:now+3600000};
 const wrong=fixture({channels:[channel("a","Network")],programs:[p],
  items:[{id:"film",title:"Some Other Movie",type:"Movie",backdrop:"https://img.example/movie.jpg"}]}).markup();
 assert.doesNotMatch(wrong,/class="tvLiveArtwork"/);
 const matched=fixture({channels:[channel("a","Network")],programs:[p],
  items:[{id:"film",title:"Real News",type:"Series",backdrop:"https://img.example/matching.jpg"}]}).markup();
 assert.match(matched,/class="tvLiveArtwork"/);
 assert.match(matched,/matching\.jpg/);
});
test("Continue Watching, movies and TV shows use the existing interactive catalog rails",()=>{
 const x=fixture({items:[
  {id:"m",title:"Film One",type:"Movie"},{id:"s",title:"Series One",type:"Series"}],
  watching:[{id:"w",title:"Episode",type:"Series"}]});
 const home=x.markup();
 assert.match(home,/Continue Watching/);
 assert.match(home,/Explore Movies/);
 assert.match(home,/Explore TV Shows/);
 assert.match(app,/LumaTVExperience\.markup\(homepageModel,shelf\)/);
 assert.match(app,/LumaTVExperience\.bind\(\)/);
 assert.match(app,/LumaTVExperience\.nav\(tvBar,state\.tab\)/);
 assert.match(app,/sidebarInput\?\.focus/);
});
test("Live channel selection opens native Luma route and stores recent channel IDs only",()=>{
 const x=fixture({channels:[channel("a","News"),channel("b","Sport")]});
 const button={dataset:{tvChannel:"b"},onclick:null};
 x.buttons.push(button);
 vm.runInContext("LumaTVExperience.bind()",x.ctx);
 button.onclick();
 assert.deepEqual(x.opened,["b"]);
 assert.deepEqual(JSON.parse(x.saved.get("luma.tv.recentChannels.v1")),["b"]);
 const rerender=x.markup();
 assert.ok(rerender.indexOf('data-tv-channel="b"')<rerender.indexOf('data-tv-channel="a"'));
 assert.match(iptv,/openChannel:selectChannel/);
 assert.match(iptv,/nativeOnly:true/);
});
test("EPG programme selection opens its actual detail view",()=>{
 const x=fixture();
 x.programButtons.push({dataset:{tvProgram:"guide123"},onclick:null});
 vm.runInContext("LumaTVExperience.bind()",x.ctx);
 x.programButtons[0].onclick();
 assert.deepEqual(x.details,["guide123"]);
 assert.match(iptv,/openProgramme:selectProgramme/);
});
test("TV Home processes large channel and programme lists without quadratic matching",()=>{
 const now=Date.now();
 const channels=Array.from({length:2500},(_,i)=>channel("ch"+i,"Channel "+i));
 const programmes=Array.from({length:18000},(_,i)=>({id:"p"+i,channel_id:"ch"+(i%2500),
  title:"Show "+i,start:now-120000,end:now+3600000}));
 const x=fixture({channels,programs:programmes});
 const start=Date.now(),home=x.markup(),elapsed=Date.now()-start;
 assert.match(home,/class="tvSpotlightArea"/);
 assert.ok(elapsed<4000,"Home should render without blocking the TV for several seconds");
});
test("Standalone index and live application stay synchronized; desktop home remains intact",()=>{
 assert.ok(html.includes(app.trim()));
 assert.ok(html.includes(iptv.trim()));
 assert.match(app,/content='<div class="lumaHomePage">'/);
 assert.match(html,/id="lumaTvNav"/);
 assert.match(css,/outline:3px solid #3caeff!important/);
});
