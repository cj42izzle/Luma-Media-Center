
"use strict";
(()=> {
  const body=document.body,side=document.querySelector(".sidebar"),nav=document.getElementById("navigation"),toggle=document.getElementById("menuToggle"),dismiss=document.getElementById("sidebarDismiss"),backdrop=document.getElementById("navBackdrop");
  if(!side||!nav||!toggle||!dismiss||!backdrop)return;
  let priorFocus=null;
  const drawerQuery=window.matchMedia("(max-width:790px), (orientation:landscape) and (max-height:650px) and (max-width:1150px)");
  function isTV(){return document.documentElement.dataset.tv==="true"||document.documentElement.dataset.lumaNative==="android-tv"||window.LumaNativePlatform==="android-tv"}
  function drawerMode(){return isTV()||drawerQuery.matches}
  function openMenu(){if(!drawerMode())return;priorFocus=document.activeElement;body.classList.add("nav-open");toggle.setAttribute("aria-expanded","true");side.removeAttribute("inert");side.setAttribute("aria-hidden","false");const first=nav.querySelector(".navbutton.active")||nav.querySelector(".navbutton");if(first)revealSidebarItem(first)}
  function closeMenu(focusBack=true){const wasOpen=body.classList.contains("nav-open");body.classList.remove("nav-open");toggle.setAttribute("aria-expanded","false");if(drawerMode())side.setAttribute("inert","");else side.removeAttribute("inert");side.setAttribute("aria-hidden",drawerMode()?"true":"false");if(wasOpen&&(focusBack||side.contains(document.activeElement))){const back=focusBack&&priorFocus&&document.contains(priorFocus)?priorFocus:toggle;back.focus({preventScroll:true})}}
  toggle.addEventListener("click",()=>body.classList.contains("nav-open")?closeMenu():openMenu());
  dismiss.addEventListener("click",()=>closeMenu());
  backdrop.addEventListener("click",()=>closeMenu());
  document.getElementById("sidebarQuickSettings")?.addEventListener("click",()=>{
    nav.querySelector('[data-tab="Settings"]')?.click();
    closeMenu(false);
  });
  nav.addEventListener("click",e=>{if(e.target.closest(".navbutton"))closeMenu(false)});
  document.addEventListener("click",e=>{if(e.target.closest("[data-go]"))closeMenu(false)});
  document.addEventListener("focusin",e=>{if(isTV()&&body.classList.contains("nav-open")&&!side.contains(e.target))closeMenu(false)});
  const media=window.matchMedia("(min-width:1200px)");
  function focusables(root){
    if(!root?.querySelectorAll)return [];
    return [...root.querySelectorAll('button:not([disabled]),summary,a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(e=>!e.hidden&&!e.disabled&&e.type!=="hidden"&&e.getAttribute?.("aria-disabled")!=="true"
        &&e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden"
        &&!e.closest('[inert],[aria-hidden="true"]'));
  }
  // Treat the drawer as an ordered list. Focus must traverse off-screen items.
  function revealSidebarItem(target){
    if(!target)return false;
    target.focus({preventScroll:true});
    target.scrollIntoView?.({block:"nearest",inline:"nearest",behavior:"auto"});
    if(nav.contains?.(target)&&typeof nav.getBoundingClientRect==="function"
      &&typeof target.getBoundingClientRect==="function"){
      const port=nav.getBoundingClientRect(),r=target.getBoundingClientRect(),pad=16;
      if(r.bottom>port.bottom-pad)nav.scrollTop+=(r.bottom-port.bottom)+pad;
      else if(r.top<port.top+pad)nav.scrollTop-=(port.top-r.top)+pad;
    }
    return true;
  }
  function moveWithinSidebar(direction){
    if(!drawerMode()||!body.classList.contains("nav-open"))return false;
    const items=focusables(side);
    if(!items.length)return false;
    const active=items.indexOf(document.activeElement),delta=direction==="ArrowDown"?1:-1;
    const next=active<0?(delta>0?0:items.length-1):active+delta;
    return next>=0&&next<items.length?revealSidebarItem(items[next]):false;
  }
  function focusAndReveal(target){
    if(body.classList.contains("nav-open")&&side.contains(target))return revealSidebarItem(target);
    if(!target)return false;
    target.focus({preventScroll:true});
    const sticky=document.querySelector(".top");
    const rect=target.getBoundingClientRect();
    const headerBottom=sticky?.getBoundingClientRect().bottom||0;
    const hiddenBehindHeader=isTV()&&!target.closest?.(".top")&&headerBottom>rect.top+12&&rect.bottom>0;
    target.scrollIntoView?.({block:hiddenBehindHeader?"center":"nearest",inline:"nearest",behavior:"auto"});
    return true;
  }
  // Navigate within the active view. Never jump into the closed drawer or behind a dialog.
  function navigate(direction){
    const dialog=document.querySelector(".lumaPlayerPortal[role=dialog]")||document.querySelector("#modal [role=dialog]");
    const drawerOpen=drawerMode()&&body.classList.contains("nav-open");
    const scope=dialog||(drawerOpen?side:(isTV()?document:document));
    const list=focusables(scope);
    if(!list.length)return false;
    const active=document.activeElement,vertical=direction==="ArrowDown"||direction==="ArrowUp";
    const sign=(direction==="ArrowDown"||direction==="ArrowRight")?1:-1;
    if(!list.includes(active)){
      // Dynamic catalog/EPG renders can replace the focused element. Resume near
      // the visible content rather than throwing focus back to the fixed header.
      if(isTV()&&!dialog&&!drawerOpen){
        const height=Number(window.innerHeight)||720;
        const visible=list.filter(e=>{const r=e.getBoundingClientRect();return r.bottom>12&&r.top<height-12});
        const content=visible.filter(e=>e.closest?.("#content"));
        const choices=content.length?content:visible.length?visible:list;
        const sorted=[...choices].sort((x,y)=>{
          const rx=x.getBoundingClientRect(),ry=y.getBoundingClientRect();
          return sign<0&&vertical?ry.bottom-rx.bottom:vertical?rx.top-ry.top:rx.left-ry.left;
        });
        return focusAndReveal(sorted[0]);
      }
      return focusAndReveal(list.find(e=>e.classList?.contains("active"))||list[0]);
    }
    const ar=active.getBoundingClientRect(),ax=ar.left+ar.width/2,ay=ar.top+ar.height/2;
    const candidates=[];
    for(const e of list){
      if(e===active)continue;
      const r=e.getBoundingClientRect(),dx=r.left+r.width/2-ax,dy=r.top+r.height/2-ay;
      const primary=(vertical?dy:dx)*sign,perp=Math.abs(vertical?dx:dy);
      // Ignore same-row jitter on Up/Down and same-column jitter on Left/Right.
      const tolerance=Math.max(10,Math.min(vertical?ar.height:ar.width,vertical?r.height:r.width)*.24);
      if(primary<=tolerance)continue;
      const allowance=(vertical?ar.width+r.width:ar.height+r.height)*.22;
      const score=primary+Math.max(0,perp-allowance)*1.6;
      candidates.push({e,score,primary});
    }
    if(candidates.length){
      let choices=candidates;
      // A sticky search/header must not steal Up/Down from rows still in content.
      if(isTV()&&vertical&&active.closest?.("#content")){
        const inContent=candidates.filter(x=>x.e.closest?.("#content"));
        if(inContent.length)choices=inContent;
      }
      choices.sort((x,y)=>x.score-y.score||x.primary-y.primary);
      return focusAndReveal(choices[0].e);
    }
    // Sparse/empty sections can be taller than a screen. Keep D-pad scrolling
    // usable even when there is no next focusable control yet.
    if(isTV()&&vertical&&!dialog&&!drawerOpen&&typeof window.scrollBy==="function"){
      const root=document.scrollingElement||document.documentElement;
      const height=Number(window.innerHeight)||720;
      const max=Math.max(0,(root.scrollHeight||0)-height);
      const pos=Number(window.scrollY??root.scrollTop??0);
      if(sign>0&&pos<max-2||sign<0&&pos>2){
        window.scrollBy({top:Math.round(height*.65)*sign,behavior:"auto"});
        return true;
      }
    }
    return false;
  }
  // D-pad left/right stays inside the active horizontal poster rail.
  // This is important in Android System WebView, which otherwise jumps into
  // another section instead of moving focus along an off-screen TV show.
  function moveWithinRail(direction){
    const active=document.activeElement,rail=active?.closest?.(".lumaHomePage .lumaShelf .tiles,.tvExperienceHome .lumaShelf .tiles");
    if(!rail)return false;
    const cards=focusables(rail).filter(x=>x.matches("button.media,[data-open]"));
    if(!cards.length)return false;
    const index=cards.indexOf(active);
    const next=index<0?(direction==="ArrowLeft"?cards.length-1:0):
      Math.max(0,Math.min(cards.length-1,index+(direction==="ArrowRight"?1:-1)));
    if(index>=0&&next===index)return false;
    cards[next].focus({preventScroll:true});
    cards[next].scrollIntoView({block:"nearest",inline:"center",behavior:"auto"});
    return true;
  }
  // In the programme grid, Up/Down keep the same station/action column
  // instead of jumping to a control elsewhere on the page.
  function moveWithinGuide(direction){
    if(!isTV()||!["ArrowUp","ArrowDown"].includes(direction)||body.classList.contains("nav-open"))return false;
    if(document.querySelector("#modal [role=dialog]")||document.querySelector(".lumaPlayerPortal[role=dialog]"))return false;
    const active=document.activeElement,row=active?.closest?.(".iptvGuideRow"),grid=row?.parentElement;
    if(!row||!grid)return false;
    const rows=[...grid.querySelectorAll(".iptvGuideRow")],index=rows.indexOf(row);
    const adjacent=rows[index+(direction==="ArrowDown"?1:-1)];
    if(!adjacent)return false;
    const choices=focusables(adjacent);
    if(!choices.length)return false;
    const sameKey=["data-iptv-fav","data-iptv-map","data-channel"].find(k=>active?.hasAttribute?.(k));
    let target=sameKey?choices.find(e=>e.hasAttribute?.(sameKey)):null;
    if(!target&&active?.hasAttribute?.("data-program")){
      const x=active.getBoundingClientRect(),cx=x.left+x.width/2;
      target=choices.filter(e=>e.hasAttribute?.("data-program")).sort((a,b)=>{
        const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
        return Math.abs(ra.left+ra.width/2-cx)-Math.abs(rb.left+rb.width/2-cx);
      })[0];
    }
    target=target||choices.find(e=>e.hasAttribute?.("data-channel"))||choices[0];
    return focusAndReveal(target);
  }
  const tabHistory=[];
  document.addEventListener("click",()=>{
    const before=typeof state!=="undefined"?String(state.tab||""):"";
    if(!before)return;
    setTimeout(()=>{
      const after=typeof state!=="undefined"?String(state.tab||""):"";
      if(after&&after!==before){
        tabHistory.push(before);
        if(tabHistory.length>30)tabHistory.shift();
      }
    },0);
  },true);
  function back(){
    const player=document.querySelector(".lumaPlayerPortal[role=dialog]");
    if(player&&player.getClientRects().length){document.getElementById("lumaPlayerClose")?.click();return true}
    const modal=document.querySelector("#modal [role=dialog]");
    if(modal&&modal.getClientRects().length){document.getElementById("closeModal")?.click();return true}
    if(body.classList.contains("nav-open")){
      const dismiss=document.getElementById("sidebarDismiss");
      if(typeof dismiss?.click==="function")dismiss.click();else closeMenu();
      return true;
    }
    if(typeof state==="undefined"||typeof render!=="function"||!tabHistory.length)return false;
    const previous=tabHistory.pop();
    if(!previous||previous===state.tab)return false;
    state.tab=previous;state.q="";state.filter="all";
    const search=document.querySelector("#search");if(search)search.value="";
    render();
    window.scrollTo?.({top:0,behavior:"auto"});
    const resume=()=>{
      const target=document.querySelector("#content .tvPrimary,#content .tvWatchButton,#content [data-open],#content button")
        ||[...document.querySelectorAll("#lumaTvNav [data-tab]")].find(button=>button.dataset.tab===previous);
      target?.focus?.({preventScroll:true});
      target?.scrollIntoView?.({block:"nearest",inline:"nearest",behavior:"auto"});
    };
    if(typeof requestAnimationFrame==="function")requestAnimationFrame(resume);else setTimeout(resume,0);
    return true;
  }
  document.addEventListener("keydown",e=>{
    if(isTV()&&(e.key==="Menu"||e.key==="ContextMenu")&&!document.querySelector("#modal [role=dialog]")){e.preventDefault();body.classList.contains("nav-open")?closeMenu():openMenu();return}
    if(isTV()&&body.classList.contains("nav-open")&&e.key==="ArrowRight"&&side.contains(document.activeElement)){e.preventDefault();closeMenu();return}
    if(["Escape","Backspace","BrowserBack","GoBack"].includes(e.key)
      &&!(e.key==="Backspace"&&["INPUT","TEXTAREA"].includes(document.activeElement?.tagName))){
      if(isTV()&&back()){e.preventDefault();return}
      if(body.classList.contains("nav-open")){e.preventDefault();closeMenu();return}
      return;
    }
    if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;
  if(isTV()&&!body.classList.contains("nav-open")&&e.key==="ArrowUp"
    &&document.activeElement?.closest?.("#content")
    &&document.activeElement.getBoundingClientRect?.().top<190){
    const rail=document.getElementById("lumaTvNav");
    const target=rail?.querySelector(".tvNavTab.active")||rail?.querySelector(".tvNavTab");
    if(target){e.preventDefault();target.focus({preventScroll:true});target.scrollIntoView?.({block:"nearest",inline:"nearest"});return}
  }
    if((e.key==="ArrowUp"||e.key==="ArrowDown")&&moveWithinSidebar(e.key)){e.preventDefault();return}
    if((e.key==="ArrowUp"||e.key==="ArrowDown")&&moveWithinGuide(e.key)){e.preventDefault();return}
    if((e.key==="ArrowLeft"||e.key==="ArrowRight")&&moveWithinRail(e.key)){
      e.preventDefault();return;
    }
    const active=document.activeElement,tag=active?.tagName;
    const vertical=e.key==="ArrowUp"||e.key==="ArrowDown";
    if(tag==="VIDEO"||active?.isContentEditable)return;
    // Android TV must be able to leave text fields with Up/Down. Horizontal
    // arrows still edit text; native SELECT uses vertical arrows for options.
    if(["INPUT","TEXTAREA"].includes(tag)&&(!isTV()||!vertical))return;
    if(tag==="SELECT"&&(!isTV()||vertical))return;
    // Directional focus is for TV browsers and hardware keyboards; preserve ordinary page arrow scrolling on touch screens.
    if(!media.matches&&!isTV()&&!body.classList.contains("nav-open")&&!document.querySelector("#modal [role=dialog]"))return;
    if(navigate(e.key))e.preventDefault();
  });
  function nativeTVReady(){if(document.documentElement.dataset.lumaNative==="android-tv"||window.LumaNativePlatform==="android-tv"){document.documentElement.dataset.tv="true";closeMenu(false)}}
  window.addEventListener("luma-native-iptv-ready",nativeTVReady);
  const update=()=>closeMenu(false);
  if(drawerQuery.addEventListener)drawerQuery.addEventListener("change",update);else drawerQuery.addListener(update);
  closeMenu(false);
  nativeTVReady();
  // Public helpers for navigation tests.
  window.LumaNavigation={openMenu,closeMenu,navigate,back};
})();
