"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const script=fs.readFileSync("tv-experience.js","utf8");
const css=fs.readFileSync("tv-experience.css","utf8");
const app=fs.readFileSync("app.js","utf8"),html=fs.readFileSync("index.html","utf8");
const iptv=fs.readFileSync("iptv.js","utf8");
function make({channels=[],items=[],watching=[]}={}){
 const opened=[],buttons=[],state={items,watching};
 const ctx={URL,document:{querySelectorAll:selector=>selector==="[data-tv-channel]"?buttons:[]},
   LumaIPTV:{channels:()=>channels,isFavorite:id=>id==="fav",openChannel:id=>opened.push(id)}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 return {ctx,opened,buttons,markup:()=>vm.runInContext("LumaTVExperience.markup(model,shelf)",Object.assign(ctx,{
   model:state,shelf:(title,list)=>'<section class="lumaShelf">'+title+" · "+list.length+"</section>"}))};
}
test("TV experience is TV-only and does not replace mobile styling",()=>{
 assert.match(css,/#lumaTvNav\{display:none\}/);
 assert.match(css,/html\[data-tv="true"\] \.tvQuickGrid/);
 assert.match(css,/html\[data-tv="true"\] \.tvHero/);
 assert.match(css,/@media\(max-width:850px\)/);
 assert.match(css,/@media\(max-width:580px\)/);
 assert.doesNotMatch(css,/\bbody\{background:/);
 assert.match(html,/href="\.\/tv-experience\.css\?v=1"/);
 assert.match(html,/src="\.\/tv-experience\.js\?v=1"/);
 assert.match(html,/id="lumaTvNav"/);
});
test("TV navigation has the primary destinations and retains focus across re-renders",()=>{
 const x=make(),buttons=["Home","Live TV","Guide","Movies","TV Shows","My Library","Recordings","Settings"].map(tab=>{
  const button={dataset:{tab},current:null,setAttribute(name,value){this[name]=value}};
  button.classList={toggle(name,value){if(name==="active")button.current=value}};
  return button;
 });
 const root={dataset:{},innerHTML:"",querySelectorAll:()=>buttons};
 x.ctx.root=root;x.ctx.selected="Home";
 vm.runInContext("LumaTVExperience.nav(root,selected)",x.ctx);
 assert.equal(root.dataset.tvNavBuilt,"true");
 assert.match(root.innerHTML,/data-tab="Home"/);
 assert.match(root.innerHTML,/data-tab="Live TV"/);
 assert.match(root.innerHTML,/data-tab="Settings"/);
 assert.match(root.innerHTML,/id="lumaTvMore"/);
 const rendered=root.innerHTML;
 x.ctx.selected="Guide";
 vm.runInContext("LumaTVExperience.nav(root,selected)",x.ctx);
 assert.equal(root.innerHTML,rendered,"TV nav DOM must be preserved so remote focus does not jump");
 assert.equal(buttons[2].current,true);
 assert.equal(buttons[2]["aria-current"],"page");
});
test("TV home uses real channel names and direct playback destinations",()=>{
 const x=make({channels:[
  {id:"fav",name:"Local Sports HD",logo:"https://img.example/sports.png",url:"http://media.example/sports.ts",group:"Sports"},
  {id:"news",name:"Local News",url:"http://media.example/news.ts",group:"News"},
  {id:"invalid",name:"No stream",url:""}]});
 const markup=x.markup();
 assert.match(markup,/data-tv-experience="true"/);
 assert.match(markup,/data-tv-channel="fav"/);
 assert.match(markup,/Local Sports HD/);
 assert.match(markup,/Local News/);
 assert.doesNotMatch(markup,/data-tv-channel="invalid"/);
 assert.match(markup,/2 IPTV channels loaded/);
 assert.match(markup,/data-go="Guide"/);
 assert.match(markup,/data-go="Settings"/);
 assert.doesNotMatch(markup,/No guide ·/);
});
test("TV Home watch actions invoke Luma's existing native playback route",()=>{
 const x=make({channels:[{id:"fav",name:"Sports",url:"http://media.example/a.ts"}]});
 const b={dataset:{tvChannel:"fav"},onclick:null};x.buttons.push(b);
 vm.runInContext("LumaTVExperience.bind()",x.ctx);
 assert.equal(typeof b.onclick,"function");
 b.onclick();assert.deepEqual(x.opened,["fav"]);
 assert.match(iptv,/openChannel:selectChannel/);
 assert.match(iptv,/nativeOnly:true/);
});
test("TV home remains useful without a provider or catalog and does not fake listings",()=>{
 const markup=make().markup();
 assert.match(markup,/Your entertainment starts here/);
 assert.match(markup,/No IPTV channels connected yet/);
 assert.match(markup,/Connect your television service/);
 assert.match(markup,/data-go="Settings"/);
 assert.doesNotMatch(markup,/data-tv-channel=/);
});
test("TV home displays real media rails without the heavy default Home modules",()=>{
 const x=make({items:[
  {id:"m",title:"Example Movie",type:"Movie",backdrop:"https://img.example/movie.jpg"},
  {id:"s",title:"Example Series",type:"Series",poster:"https://img.example/show.jpg"}],
  watching:[{id:"w",title:"Continue Item",type:"Movie"}]});
 const markup=x.markup();
 assert.match(markup,/tvHeroImage/);
 assert.match(markup,/Continue watching/);
 assert.match(markup,/Explore movies/);
 assert.match(markup,/Discover series/);
 assert.match(app,/LumaTVExperience\.markup\(homepageModel,shelf\)/);
 assert.match(app,/LumaTVExperience\.bind\(\)/);
 assert.match(app,/LumaTVExperience\.nav\(tvBar,state\.tab\)/);
});
test("TV interface leaves desktop Home rendering intact and standalone sources synchronized",()=>{
 assert.match(app,/hero\(\[\.\.\.LumaReleases\.all\(\)\.filter\(x=>x\.backdrop\),\.\.\.filtered\]\)/);
 assert.ok(html.includes(app.trim()),"Standalone HTML must embed the latest app.js");
 assert.ok(html.includes(iptv.trim()),"Standalone HTML must embed the latest IPTV module");
});
test("Android TV layout gives focusable controls sufficient size",()=>{
 for(const required of [".tvNavTab",".tvQuickCard",".tvChannelCard",".tvHero",".tvPrimary",".iptvGuideCategory"])
  assert.ok(css.includes(required),"Missing TV styling: "+required);
 assert.match(css,/\[data-tv="true"\] \.tvNavTab[\s\S]*min-height:49px/);
 assert.match(css,/\[data-tv="true"\] \.tvQuickCard[\s\S]*min-height:107px/);
 assert.match(css,/outline:4px solid #98ffe3!important/);
});
