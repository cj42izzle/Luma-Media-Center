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
        page.add_init_script("""localStorage.setItem('luma.addons.v1',JSON.stringify(['east','west'].map(id=>({
            url:'https://'+id+'.example/manifest.json', enabled:true,
            manifest:{id,name:id+' fixture',resources:['stream'],types:['movie'],catalogs:[]}
        }))));""")
        shared="https://media.example/shared.mp4"
        page.route("https://east.example/stream/movie/*.json",lambda route: route.fulfill(json={"streams":[
            {"name":"[RD+] 2160p","title":"Overlook","url":shared,"audioLanguages":["ja"],"subtitles":[{"lang":"en"}]},
            {"name":"1080p","title":"River","infoHash":"a"*40,"seeders":17}]}))
        page.route("https://west.example/stream/movie/*.json",lambda route: route.fulfill(json={"streams":[
            {"name":"[RD+] 2160p","title":"Overlook","url":shared,"audioLanguages":["ja"],"subtitles":[{"lang":"en"}]}]}))
        page.route("https://v3-cinemeta.strem.io/meta/*/tt0133093.json",lambda route: route.fulfill(json={"meta":{"trailers":[{"type":"Trailer","source":"FVI84Dfx2-I"}]}}))
        page.goto(sys.argv[1], wait_until="domcontentloaded")
        page.evaluate("""() => {
            const cards=Array.from({length:10},(_,i)=>({id:"scroll-"+i,title:"Title "+i,type:"Movie",poster:"https://images.example/poster.jpg"}));
            const home=document.querySelector(".lumaHomePage");
            home.innerHTML=hero(cards)+shelf("Scroll test",cards);
            bindHeroSwipes();
            window.testRail=home.querySelector(".tiles");
            testRail.scrollLeft=180;
        }""")
        offset=page.evaluate("testRail.scrollLeft")
        page.locator('[data-hero-page="1"]').click()
        assert page.evaluate("testRail.isConnected && document.querySelector('.lumaPersonalHero h2').textContent==='Title 1'")
        assert abs(page.evaluate("testRail.scrollLeft")-offset)<2
        page.locator('[data-mobile="More"]').click()
        page.locator('[data-mobile-page="Settings"]').click()
        option=page.locator('[data-home-option="shortcuts"]')
        option.check()
        page.evaluate("""() => {
            localStorage.setItem("luma.catalog.feeds.v3.FR", '{"stale":true}');
            localStorage.setItem("luma.v2.languageLookupV1",'{"test-stale-language":{}}');
            localStorage.setItem("luma.epcalendar.follows.v1",'{"saved-title":{"title":"Keep this title"}}');
        }""")
        with page.expect_navigation(wait_until="domcontentloaded"):
            page.get_by_role("button",name="Clear cache",exact=True).click()
        assert option.is_checked()
        assert page.evaluate("""() =>
            !localStorage.getItem("luma.catalog.feeds.v3.FR") &&
            !Object.hasOwn(JSON.parse(localStorage.getItem("luma.v2.languageLookupV1")||"{}"),"test-stale-language") &&
            JSON.parse(localStorage.getItem("luma.epcalendar.follows.v1"))["saved-title"].title==="Keep this title"
        """)
        page.locator('[data-mobile="Home"]').click()
        assert page.locator(".lumaHomeQuick").is_visible()
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
        for kind,width,height in [("Movie",667,375),("Series",896,414)]:
            page.set_viewport_size({"width":width,"height":height})
            page.evaluate("""kind=>{
                const title={id:"fixture-detail",imdbId:"tt0133093",type:kind,title:"A long landscape title for the detail screen",overview:"Synopsis. ".repeat(40)};
                state.items=[title];state.tab="Movies";state.q="fixture";state.loading=false;
                const titles=[title,...Array.from({length:10},(_,i)=>({...title,id:"extra-"+i,title:"Extra "+i}))];
                document.querySelector("#content").innerHTML=shelf("Test titles",titles);
                const tile=document.querySelector('[data-open="fixture-detail"]');
                tile.onclick=()=>openTitle(tile.dataset.open);
            }""",kind)
            assert page.locator(".railArrow:visible").count()==0
            assert page.locator(".lumaShelf .tiles").evaluate("""rail=>{
                rail.scrollLeft=rail.clientWidth;
                const moved=rail.scrollLeft>0;
                rail.scrollLeft=0;
                return moved;
            }""")
            page.locator('[data-open="fixture-detail"]').first.click()
            dialog=page.locator("#modal .dialog")
            dialog.wait_for()
            page.locator("#watchTrailer").click()
            trailer=page.locator(".lumaTrailerDialog")
            trailer.locator("iframe").wait_for()
            assert trailer.locator("a").get_attribute("href")=="https://www.youtube.com/watch?v=FVI84Dfx2-I"
            trailer.get_by_role("button",name="Close trailer").click()
            dialog.wait_for()
            assert dialog.evaluate("""el=>{
                const r=el.getBoundingClientRect(),art=el.querySelector('.detailArt').getBoundingClientRect(),
                    body=el.querySelector('.lumaTitleDetail').getBoundingClientRect();
                return r.left>=0 && r.right<=innerWidth+1 && r.height<=innerHeight && body.left>=art.right-1 &&
                    el.scrollWidth<=el.clientWidth+1;
            }""")
            page.locator("#findStreams").scroll_into_view_if_needed()
            if kind=="Series": page.locator("#seasonSelect").scroll_into_view_if_needed()
            dialog.evaluate("el=>el.scrollTop=el.scrollHeight")
            assert page.locator("#closeModal").evaluate("""el=>{
                const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;
            }""")
            page.locator("#closeModal").click()
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
        page.evaluate("LumaAddons.lookupTitle({id:'qa-movie',type:'Movie',title:'Overlook'},'tt1234567')")
        page.locator(".streamCount",has_text="3 sources").wait_for()
        page.locator("#streamProvider").select_option("west")
        page.locator("#stream-quality").select_option("4K")
        page.locator("#streamMoreFilters summary").click()
        page.locator("#stream-cache").select_option("Cached")
        page.locator("#stream-audio").select_option("Japanese")
        page.locator("#stream-subtitles").select_option("English")
        assert page.locator(".streamPageStatus").inner_text()=="Showing 1–1 of 1"
        for width,height in [(320,700),(390,844),(844,390)]:
            page.set_viewport_size({"width":width,"height":height})
            page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
            layout=page.locator(".streamFilters").evaluate("""panel=>({
                viewport:innerWidth, panelWidth:panel.clientWidth, contentWidth:panel.scrollWidth,
                expanded:panel.querySelector('details').open,
                controls:[...panel.querySelectorAll('select')].map(control=>{
                    const r=control.getBoundingClientRect();return [control.id,r.left,r.right,r.width];
                })
            })""")
            assert layout["expanded"] and layout["contentWidth"]<=layout["panelWidth"]+1, (width,height,layout)
            assert all(w>0 and left>=0 and right<=layout["viewport"]+1
                       for _,left,right,w in layout["controls"]), (width,height,layout)
        page.locator(".streamPlay").click()
        assert page.get_by_text("Source: west fixture",exact=True).is_visible()
        page.locator("#backStreamList").click()
        assert page.locator("#streamProvider").input_value()=="west"
        page.locator("#stream-quality").select_option("1080p")
        page.locator("#streamClearFilters").click()
        assert page.locator(".streamPageStatus").inner_text()=="Showing 1–3 of 3"
        page.close()
    browser.close()
