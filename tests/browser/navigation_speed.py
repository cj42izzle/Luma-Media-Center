"""Populated WebKit navigation, delayed guide refresh, and TV player return checks."""
import io
import wave
from statistics import median


def check_navigation(browser, iphone, url):
    page = browser.new_page(**iphone)
    page.add_init_script("""const channels=Array.from({length:160},(_,i)=>({
      id:'fixture-'+i,provider_id:'qa',name:'Channel '+i,url:'https://qa.invalid/'+i+'.ts'}));
      const start=Date.now()-60000;
      const programs=channels.flatMap(c=>Array.from({length:6},(_,i)=>({
        id:c.id+'-'+i,channel_id:c.id,title:'Programme '+i,start:start+i*1800000,end:start+(i+1)*1800000})));
      localStorage.setItem('luma.iptv.v1',JSON.stringify({m3u:"https://qa.invalid/slow.m3u",importedChannels:channels,importedPrograms:programs}));""")
    page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(url) else r.abort())
    playlist="#EXTM3U\n#EXTINF:-1,Fixture\nhttps://qa.invalid/fixture.ts"
    page.route("https://qa.invalid/slow.m3u",lambda r:r.fulfill(body=playlist,headers={"Access-Control-Allow-Origin":"*"}))
    page.goto(url, wait_until="load")
    page.evaluate("""() => {state.library=Array.from({length:300},(_,i)=>({
      id:'personal-'+i,title:'Saved movie '+i,source:'personal',type:'Movie'}));}""")
    page.evaluate("""() => {
      window.timing={};
      document.addEventListener('click',e=>{
        const button=e.target.closest('[data-mobile]');
        if(!button || !window.timing.selector)return;
        const sample=window.timing,start=performance.now();
        function frame(){
          if(sample!==window.timing)return;
          const selected=document.querySelector('#lumaMobileNav .active');
          if(selected?.dataset.mobile===sample.active){
            sample.highlight??=performance.now()-start;
            const el=document.querySelector(sample.selector);
            if(el && el.getClientRects().length && !el.disabled){
              sample.usable=performance.now()-start;return;
            }
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      },true);
    }""")
    paths=[('Catalogs','Catalogs','.catalogIntro'),('My Library','My Library','#libraryQuery'),
           ('Home','Home','.lumaHomePage'),('Live TV','Live TV','.todayHub'),
           ('Guide','Guide','.iptvGuideRow [data-channel]'),('Live TV','Live TV','.todayHub'),('@streaming','Home','.lumaHomePage')]
    results={}
    for _ in range(3):
        for button, active, selector in paths:
            page.evaluate("x=>window.timing=x",dict(active=active,selector=selector))
            page.locator(f'[data-mobile="{button}"]').tap()
            try:
                page.wait_for_function("window.timing.usable!==undefined",timeout=5000)
            except Exception:
                print(button,page.evaluate("""() => ({timing:window.timing,tab:state.tab,
                  heading:document.querySelector('#heading').textContent,body:document.querySelector('#content').innerText.slice(0,400)})"""),flush=True)
                raise
            sample=page.evaluate("window.timing")
            results.setdefault(button,[]).append((sample['highlight'],sample['usable']))
    for button,samples in results.items():
        print(f"Navigation timing {button}: highlight {median(a for a,b in samples):.0f} ms, "
              f"usable {median(b for a,b in samples):.0f} ms (median of three)",flush=True)
    # Hold an actual provider response until after returning to streaming.
    held=[]
    page.route("https://qa.invalid/slow.m3u", lambda route: held.append(route))
    with page.expect_request("https://qa.invalid/slow.m3u"):
        page.evaluate("() => {window.slowUpdate=LumaIPTV.loadGuide()}")
    page.evaluate("""() => {
      for(const tab of ['Live TV','Guide','@streaming'])document.querySelector('[data-mobile="'+tab+'"]').click();
    }""")
    assert held
    held[0].fulfill(body=playlist,headers={"Access-Control-Allow-Origin":"*"})
    page.evaluate("window.slowUpdate")
    page.locator('.lumaHomePage').wait_for()
    assert not page.locator('.iptvGuidePage').count()
    page.close()


def check_tv_return(browser,url):
    page=browser.new_page(viewport={"width":1920,"height":1080})
    page.add_init_script("window.LumaNativePlatform='android-tv'")
    buffer=io.BytesIO()
    with wave.open(buffer,"wb") as audio:
        audio.setparams((1,2,8000,0,'NONE',''))
        audio.writeframes(bytes(8000*2*8))
    page.route("**/*",lambda r:r.continue_() if r.request.url.startswith(url) else r.abort())
    page.route("https://qa.invalid/fixture.wav",lambda r:r.fulfill(content_type="audio/wav",body=buffer.getvalue()))
    page.goto(url,wait_until="load")
    page.evaluate("""() => {state.library=[1,2].map(i=>({id:'tv-'+i,title:'Movie '+i,
      source:'personal',type:'Movie',url:'https://qa.invalid/fixture.wav'}));}""")
    page.locator('#lumaTvNav [data-tab="My Library"]').press('Enter')
    poster=page.locator('[data-open="tv-2"]')
    page.locator('[data-open="tv-1"]').press('ArrowRight')
    assert poster.evaluate("el=>el===document.activeElement")
    page.keyboard.press('Enter')
    page.locator('#findStreams').press('Enter')
    page.wait_for_function("document.querySelector('#lumaPlayerVideo')?.currentTime>0",timeout=12000)
    page.locator('#lumaPlayerClose').press('Backspace')
    page.locator('#findStreams').wait_for()
    page.keyboard.press('Backspace')
    assert poster.evaluate("el=>el===document.activeElement")
    page.close()
