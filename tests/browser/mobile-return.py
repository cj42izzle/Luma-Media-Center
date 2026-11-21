"""Exercise mobile WebKit history with a local IPTV fixture and no external feeds."""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as runtime:
    browser = runtime.webkit.launch()
    for standalone in (False, True):
        page = browser.new_page(**runtime.devices["iPhone 13"])
        page.add_init_script("""
            Object.defineProperty(navigator,'standalone',{value:%s});
            const now=Date.now();
            const channel={id:'qa',provider_id:'fixture',name:'Fixture station',url:'https://fixture.invalid/live.ts'};
            localStorage.setItem('luma.iptv.v1',JSON.stringify({importedChannels:[channel],
                importedPrograms:[{id:'airing',channel_id:'qa',title:'Fixture show',start:now-60000,end:now+3600000}]}));
        """ % str(standalone).lower())
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(sys.argv[1]) else route.abort())
        page.goto(sys.argv[1], wait_until="domcontentloaded")
        page.locator('[data-mobile="Catalogs"]').click()
        for width in (320, 390, 414):
            page.set_viewport_size({"width":width,"height":844})
            assert page.evaluate("""() => {
                const heading=document.querySelector('#heading').getBoundingClientRect();
                const profile=document.querySelector('#lumaProfileQuick').getBoundingClientRect();
                const field=document.querySelector('#search'), box=field.getBoundingClientRect();
                return getComputedStyle(document.querySelector('.top small')).display==='none' &&
                  getComputedStyle(field).borderTopWidth==='0px' && box.left>=0 && box.right<=innerWidth+1 &&
                  box.top>=heading.bottom && heading.right<=profile.left+1;
            }""")
        for width,height in [(667,375),(844,390),(896,414),(932,430)]:
            page.set_viewport_size({"width":width,"height":height})
            assert page.evaluate("""() => {
                const box=s=>document.querySelector(s).getBoundingClientRect();
                const h=box('#heading'), search=box('#search'), profile=box('#lumaProfileQuick'), dock=box('#lumaMobileNav');
                return search.left>=h.right-1 && search.right<=profile.left+1 && search.top<h.bottom &&
                  dock.width>0 && dock.bottom<=innerHeight+1 && dock.height<innerHeight/4 &&
                  getComputedStyle(document.querySelector('.sidebar')).display==='none';
            }""")
        page.locator('[data-mobile="Home"]').click()
        page.locator('[data-mobile="Live TV"]').click()
        page.locator(".todayHub h2").wait_for()
        page.locator('.todayHub [data-day-offset="6"]').click()
        assert page.locator('.todayHub [data-day-offset="6"]').get_attribute("aria-pressed") == "true"
        switch = page.locator('[data-mobile="@streaming"]')
        switch.evaluate("(button)=>{window.originalSwitch=button;nav()}")
        assert switch.evaluate("(button)=>button===window.originalSwitch")
        switch.click()
        page.evaluate("LumaIPTV.render();LumaIPTV.render('connections')")
        assert page.evaluate("state.tab==='Home' && !document.querySelector('.todayHub') && !!document.querySelector('.lumaHomePage')")
        page.locator('[data-mobile="Live TV"]').click()
        page.locator('[data-mobile="Guide"]').click()
        page.locator('.iptvGuideScroll [data-channel="qa"]').click()
        page.locator('#iptvStartPlayback').click()
        video = page.locator('#lumaPlayerVideo')
        video.wait_for()
        key = page.evaluate('profileStorageKey("lastPlayedChannel")')
        assert page.evaluate("key=>localStorage.getItem(key)", key) is None
        page.locator('#lumaPlayerGuide').wait_for(timeout=20000)
        assert page.locator('#lumaPlayerRetry').is_visible()
        # Inject the successful playback signal independently of unavailable provider media.
        video.dispatch_event("playing")
        assert page.evaluate("key=>localStorage.getItem(key)", key) == "qa"
        page.evaluate("window.testVideo=document.querySelector('#lumaPlayerVideo')")
        page.locator('#lumaPlayerClose').click()
        page.wait_for_function("!history.state?.lumaPlayer")
        assert page.evaluate("state.tab==='Guide' && testVideo.paused && !testVideo.isConnected")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("state.tab==='Guide'")
        page.locator('.iptvGuideScroll [data-channel="qa"]').wait_for()
        # Open a calendar detail sheet over the selected day, then use the real tune handler.
        page.evaluate("""() => {state.tab='Calendar';render();
            modal('<h2 id="fixtureShow">Fixture show</h2><button id="fixtureTune">Watch channel</button>');
            document.querySelector('#fixtureTune').onclick=()=>LumaIPTV.tuneProgramme('airing');}""")
        day = page.locator('[data-day].picked').first.get_attribute("data-day")
        page.locator('#fixtureTune').click()
        video.wait_for()
        page.evaluate("window.testVideo=document.querySelector('#lumaPlayerVideo');history.back()")
        page.locator('#fixtureShow').wait_for()
        page.wait_for_function("!document.querySelector('#lumaPlayerVideo')")
        assert page.evaluate("testVideo.paused && !testVideo.isConnected")
        assert page.locator('[data-day].picked').first.get_attribute("data-day") == day
        page.evaluate("history.back()")
        page.locator('#fixtureShow').wait_for(state="detached")
        assert page.evaluate("state.tab") == "Calendar"
        page.close()
    browser.close()
