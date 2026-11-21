"use strict";
/* Touch-first navigation for the existing Luma web app. TV and desktop stay separate. */
const LumaMobileNav=(()=>{
 const destinations=[
  {tab:"Home",icon:"⌂",label:"Home"},
  {tab:"Catalogs",icon:"⌕",label:"Search"},
  {tab:"Live TV",icon:"▣",label:"Live TV"},
  {tab:"My Library",icon:"▰",label:"Library"},
  {tab:"More",icon:"☷",label:"More"}
 ];
 const morePages=[
  ["Movies","Movies"],["TV Shows","TV Shows"],["Anime","Anime"],
  ["Guide","TV Guide"],["Recordings","Recordings"],["Watchlist","Watchlist"],
  ["Favorites","Favorites"],["Continue Watching","Continue Watching"],
  ["IPTV Library","IPTV Library"],["Calendar","Calendar"],
  ["Releases","New Releases"],["Streaming","Streaming Services"],
  ["Add-ons","Add-ons"],["Settings","Settings"]
 ];
 let root=null,menu=null,open=false;
 function ensure(){
  if(typeof document==="undefined"||!document.body)return false;
  if(root&&root.isConnected!==false)return true;
  root=document.querySelector("#lumaMobileNav");
  if(!root){
   root=document.createElement("nav");
   root.id="lumaMobileNav";root.className="lumaMobileNav";
   root.setAttribute("aria-label","Primary mobile navigation");
   document.body.appendChild(root);
  }
  menu=document.querySelector("#lumaMobileMore");
  if(!menu){
   menu=document.createElement("div");menu.id="lumaMobileMore";menu.className="lumaMobileMore";
   menu.hidden=true;menu.setAttribute("role","dialog");menu.setAttribute("aria-label","More Luma sections");
   document.body.appendChild(menu);
  }
  return true;
 }
 function select(tab){
  if(typeof state==="undefined")return;
  open=false;
  state.tab=tab;state.q="";state.filter="all";
  const search=document.querySelector("#search");if(search)search.value="";
  if(typeof render==="function")render();
  if(tab==="Catalogs"){const input=document.querySelector("#search");input?.focus?.({preventScroll:true})}
  window.scrollTo?.({top:0,behavior:"instant"});
 }
 function toggle(value){
  open=!!value;
  if(!ensure())return;
  menu.hidden=!open;
  const button=root.querySelector('[data-mobile="More"]');
  button?.setAttribute("aria-expanded",open?"true":"false");
  if(open)menu.querySelector("button")?.focus?.();
  else button?.focus?.();
 }
 function renderNav(tab){
  if(!ensure())return;
  const active=destinations.some(x=>x.tab===tab)?tab:
   ["Watchlist","Favorites","Continue Watching","IPTV Library"].includes(tab)?"My Library":
   ["Movies","TV Shows","Anime","Releases","Streaming","Add-ons"].includes(tab)?"Catalogs":
   ["Guide","Recordings"].includes(tab)?"Live TV":"More";
  root.innerHTML=destinations.map(x=>'<button type="button" data-mobile="'+x.tab+'"'+(active===x.tab?' class="active" aria-current="page"':'')+
   (x.tab==="More"?' aria-expanded="'+(open?'true':'false')+'" aria-controls="lumaMobileMore"':'')+
   '><span aria-hidden="true">'+x.icon+'</span><small>'+x.label+'</small></button>').join("");
  menu.innerHTML='<div class="lumaMobileMoreHeader"><b>Explore Luma</b><button type="button" id="lumaMobileMoreClose" aria-label="Close menu">✕</button></div>'+
   '<div class="lumaMobileMoreGrid">'+morePages.map(([dest,label])=>'<button type="button" data-mobile-page="'+dest+'">'+label+'</button>').join("")+'</div>';
  menu.hidden=!open;
  root.querySelectorAll("[data-mobile]").forEach(button=>button.onclick=()=>{
   const next=button.getAttribute("data-mobile");
   if(next==="More")toggle(!open);else select(next);
  });
  menu.querySelector("#lumaMobileMoreClose").onclick=()=>toggle(false);
  menu.querySelectorAll("[data-mobile-page]").forEach(button=>button.onclick=()=>select(button.getAttribute("data-mobile-page")));
 }
 if(typeof document!=="undefined"){
  document.addEventListener("keydown",e=>{if(open&&(e.key==="Escape"||e.key==="Backspace")){e.preventDefault();toggle(false)}});
  document.addEventListener("pointerdown",e=>{
   if(open&&root&&!root.contains(e.target)&&menu&&!menu.contains(e.target))toggle(false);
  });
 }
 return {render:renderNav,close:()=>toggle(false)};
})();
if(typeof document!=="undefined")LumaMobileNav.render(typeof state!=="undefined"?state.tab:"Home");
