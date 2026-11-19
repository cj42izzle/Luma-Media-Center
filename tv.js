
"use strict";
(()=> {
  const body=document.body,side=document.querySelector(".sidebar"),nav=document.getElementById("navigation"),toggle=document.getElementById("menuToggle"),dismiss=document.getElementById("sidebarDismiss"),backdrop=document.getElementById("navBackdrop");
  if(!side||!nav||!toggle||!dismiss||!backdrop)return;
  let priorFocus=null;
  const drawerQuery=window.matchMedia("(max-width:790px), (orientation:landscape) and (max-height:650px) and (max-width:1150px)");
  function drawerMode(){return document.documentElement.dataset.tv==="true"?false:drawerQuery.matches}
  function openMenu(){if(!drawerMode())return;priorFocus=document.activeElement;body.classList.add("nav-open");toggle.setAttribute("aria-expanded","true");side.removeAttribute("inert");const first=nav.querySelector(".navbutton.active")||nav.querySelector(".navbutton");if(first)first.focus({preventScroll:true})}
  function closeMenu(focusBack=true){const wasOpen=body.classList.contains("nav-open");body.classList.remove("nav-open");toggle.setAttribute("aria-expanded","false");if(drawerMode())side.setAttribute("inert","");else side.removeAttribute("inert");if(wasOpen&&focusBack&&(priorFocus||toggle)){(priorFocus||toggle).focus({preventScroll:true})}}
  toggle.addEventListener("click",()=>body.classList.contains("nav-open")?closeMenu():openMenu());
  dismiss.addEventListener("click",()=>closeMenu());
  backdrop.addEventListener("click",()=>closeMenu());
  nav.addEventListener("click",e=>{if(e.target.closest(".navbutton"))closeMenu(false)});
  document.addEventListener("click",e=>{if(e.target.closest("[data-go]"))closeMenu(false)});
  const media=window.matchMedia("(min-width:1200px)");
  function focusables(root){return [...root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden"&&!e.closest("[inert]")&&!e.closest('[aria-hidden="true"]'))}
  function navigate(direction){
    const dialog=document.querySelector("#modal [role=dialog]");
    const scope=dialog||((drawerMode()&&body.classList.contains("nav-open"))?side:document);
    const list=focusables(scope);
    if(!list.length)return false;
    let active=document.activeElement;
    if(!list.includes(active)){(list.find(e=>e.classList.contains("active"))||list[0]).focus({preventScroll:true});return true}
    const ar=active.getBoundingClientRect(),ax=ar.left+ar.width/2,ay=ar.top+ar.height/2;
    const vertical=direction==="ArrowDown"||direction==="ArrowUp",sign=(direction==="ArrowDown"||direction==="ArrowRight")?1:-1;
    let best=null,bestScore=Infinity;
    for(const e of list){if(e===active)continue;const r=e.getBoundingClientRect(),dx=r.left+r.width/2-ax,dy=r.top+r.height/2-ay,primary=vertical?dy*sign:dx*sign,perp=Math.abs(vertical?dx:dy);if(primary<3)continue;const score=primary+perp*1.65;if(score<bestScore){best=e;bestScore=score}}
    if(!best)return false;best.focus({preventScroll:true});best.scrollIntoView({block:"nearest",inline:"nearest",behavior:"auto"});return true
  }
  // D-pad left/right stays inside the active horizontal poster rail.
  // This is important in Android System WebView, which otherwise jumps into
  // another section instead of moving focus along an off-screen TV show.
  function moveWithinRail(direction){
    const active=document.activeElement,rail=active?.closest?.(".lumaHomePage .lumaShelf .tiles");
    if(!rail)return false;
    const cards=focusables(rail).filter(x=>x.matches("button.media,[data-open]"));
    if(!cards.length)return false;
    const index=cards.indexOf(active);
    const next=index<0?(direction==="ArrowLeft"?cards.length-1:0):
      Math.max(0,Math.min(cards.length-1,index+(direction==="ArrowRight"?1:-1)));
    cards[next].focus({preventScroll:true});
    cards[next].scrollIntoView({block:"nearest",inline:"center",behavior:"auto"});
    return true;
  }
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"||e.key==="Backspace"&&!["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)){
      if(body.classList.contains("nav-open")){e.preventDefault();closeMenu();return}
      if(e.key==="Backspace"&&document.querySelector("#modal [role=dialog]")){e.preventDefault();const close=document.getElementById("closeModal");close?.click();return}
      return;
    }
    if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;
    if((e.key==="ArrowLeft"||e.key==="ArrowRight")&&moveWithinRail(e.key)){
      e.preventDefault();return;
    }
    const active=document.activeElement,tag=active?.tagName;
    if(["INPUT","TEXTAREA","SELECT","VIDEO"].includes(tag)||active?.isContentEditable)return;
    // Directional focus is for TV browsers and hardware keyboards; preserve ordinary page arrow scrolling on touch screens.
    if(!media.matches&&document.documentElement.dataset.tv!=="true"&&!body.classList.contains("nav-open")&&!document.querySelector("#modal [role=dialog]"))return;
    if(navigate(e.key))e.preventDefault();
  });
  const update=()=>closeMenu(false);
  if(drawerQuery.addEventListener)drawerQuery.addEventListener("change",update);else drawerQuery.addListener(update);
  closeMenu(false);
  // Public helpers for navigation tests.
  window.LumaNavigation={openMenu,closeMenu,navigate};
})();
