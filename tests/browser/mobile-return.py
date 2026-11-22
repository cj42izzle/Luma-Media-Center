"""Exercise mobile WebKit history with a local IPTV fixture and no external feeds."""
import sys
from navigation_speed import check_navigation, check_tv_return
from playwright.sync_api import sync_playwright

with sync_playwright() as runtime:
    browser = runtime.webkit.launch()
    check_navigation(browser,runtime.devices["iPhone 13"],sys.argv[1])
    check_tv_return(browser,sys.argv[1])
    for layout, width, height in [
        ("Tablet", 1024, 768), ("Desktop", 1440, 900), ("TV", 1920, 1080)
    ]:
        page = browser.new_page(viewport={"width": width, "height": height},
                                has_touch=layout == "Tablet")
        if layout == "TV":
            page.add_init_script("window.LumaNativePlatform='android-tv'")
        page.route("**/*", lambda route: route.continue_()
                   if route.request.url.startswith(sys.argv[1]) else route.abort())
        page.goto(sys.argv[1], wait_until="domcontentloaded")
        rail = page.locator("#lumaTvNav" if layout == "TV" else "#navigation")
        for dest, heading in [("Guide", "TV Guide"), ("My Library", "My Library"), ("Home", "Home")]:
            button = rail.locator(f'[data-tab="{dest}"]')
            if layout == "Tablet":
                button.tap()
            else:
                button.press("Enter")
            page.wait_for_function("heading => document.querySelector('#heading').textContent === heading",
                                   arg=heading, timeout=3000)
            if layout == "Desktop":
                assert button.evaluate("el => el === document.activeElement")
        page.close()
        print(f"{layout} navigation passed", flush=True)

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
            {"name":"[RD+] 2160p","title":"Overlook","url":shared,"audioLanguages":["ja"],"subtitles":[{"lang":"es","url":"https://subs.example/es.vtt"},{"lang":"en","url":"https://subs.example/en.vtt"}]}]}))
        page.route("https://v3-cinemeta.strem.io/meta/*/tt0133093.json",lambda route: route.fulfill(json={"meta":{"trailers":[{"type":"Trailer","source":"FVI84Dfx2-I"}]}}))
        page.goto(sys.argv[1], wait_until="domcontentloaded")
        page.evaluate("""() => {
            const cards=Array.from({length:10},(_,i)=>({usReleaseDate:airDay(),id:"scroll-"+i,title:"Title "+i,type:"Movie",poster:"https://images.example/poster.jpg"}));
            const home=document.querySelector(".lumaHomePage");
            home.innerHTML=hero(cards)+shelf("Scroll test",cards);
            bindHeroSwipes();
            window.testRail=home.querySelector(".tiles");
            testRail.scrollLeft=180;
        }""")
        for width,height in [(390,844),(844,390)]:
            page.set_viewport_size({"width":width,"height":height})
            assert page.evaluate("""() => {
                const hero=document.querySelector('.usReleaseHero'), art=hero.querySelector('picture').getBoundingClientRect(),
                      title=hero.querySelector('h2').getBoundingClientRect();
                return art.width>0 && art.height>0 && (title.top>=art.bottom-1 || title.left>=art.right-1);
            }""")
        page.set_viewport_size({"width":390,"height":844})
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
        page.locator(".lumaHomeQuick").wait_for(timeout=3000)
        page.locator('[data-mobile="Catalogs"]').click()
        page.wait_for_function("document.querySelector('#heading').textContent === 'Catalogs'")
        for width in (320, 390, 414):
            page.set_viewport_size({"width":width,"height":844})
            assert page.evaluate("""() => {
                const heading=document.querySelector('#heading').getBoundingClientRect();
                const profile=document.querySelector('#lumaProfileQuick').getBoundingClientRect();
                const field=document.querySelector('#search'), box=field.getBoundingClientRect();
                return getComputedStyle(document.querySelector('.top small')).display==='none' &&
                  getComputedStyle(field).borderTopWidth==='0px' && box.left>=0 && box.right<=innerWidth+1 &&
                  box.top>=heading.bottom && heading.right<=profile.left+1;
            }"""), page.evaluate("""() => [innerWidth,...['#heading','#lumaProfileQuick','#search','.top small'].map(s=>{
                const el=document.querySelector(s);return [s,el.getBoundingClientRect().toJSON(),getComputedStyle(el).display,getComputedStyle(el).borderTopWidth];
            })]""")
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
        page.locator(".lumaHomePage").wait_for(timeout=3000)
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
        assert page.locator('#stream-quality option[value="1080p"]').count()==0
        assert page.locator('#stream-quality option[value="4K"]').inner_text()=="4K (1)"
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
                controls:[...panel.querySelectorAll('button, select, summary')].map(control=>{
                    const r=control.getBoundingClientRect();return [control.id,r.left,r.right,r.width];
                })
            })""")
            assert layout["expanded"] and layout["contentWidth"]<=layout["panelWidth"]+1, (width,height,layout)
            assert all(w>0 and left>=0 and right<=layout["viewport"]+1
                       for _,left,right,w in layout["controls"]), (width,height,layout)
        page.locator("#streamSavePreset").click()
        page.locator("#streamPresetForm input").fill("West 4K with captions")
        page.locator("#streamPresetForm button[type=submit]").click()
        page.locator(".streamPlay").click()
        assert page.get_by_text("Source: west fixture",exact=True).is_visible()
        page.evaluate("""() => {document.addEventListener('click',e=>{
            const a=e.target.closest('a');if(a && /^(infuse|open-vidhub):/.test(a.href)){e.preventDefault();window.testHandoff=a.href;}
        },true)}""")
        for player in ["extInfuse","extVidHub"]:
            page.locator("#"+player).click()
            assert page.evaluate("new URL(testHandoff).searchParams.get('sub')")=="https://subs.example/en.vtt"
        page.locator("#backStreamList").click()
        assert page.locator("#streamProvider").input_value()=="west"
        page.locator("#streamReset").click()
        assert page.locator(".streamPageStatus").inner_text()=="Showing 1–3 of 3"
        page.reload(wait_until="domcontentloaded")
        page.evaluate("LumaAddons.lookupTitle({id:'another',type:'Movie',title:'Another movie'},'tt1234568')")
        page.get_by_role("button",name="West 4K with captions",exact=True).click()
        assert page.locator("#streamProvider").input_value()=="west"
        assert page.locator("#stream-subtitles").input_value()=="English"
        assert page.locator(".streamPageStatus").inner_text()=="Showing 1–1 of 1"
        page.get_by_role("button",name="Remove preset West 4K with captions").click()
        assert page.get_by_role("button",name="West 4K with captions",exact=True).count()==0
        page.locator("#streamReset").click()
        page.locator("#streamQuery").fill("River")
        assert page.locator(".streamDisplayName").all_text_contents()==["River"]
        page.locator("#closeModal").click()
        page.evaluate("""() => {
            state.tab='TV Shows';state.selected={id:'return-qa',title:'Return fixture',type:'Series',imdbId:'tt1234567'};
            state.season=2;state.details={seasons:[{season_number:2}],episodes:Array.from({length:16},(_,i)=>({
              season_number:2,episode_number:i+1,name:'Episode '+(i+1),overview:'Episode overview'}))};
            showDetails();
        }""")
        episode=page.locator('.episodeRow').nth(9).locator('button[data-ep]')
        episode.scroll_into_view_if_needed()
        page.evaluate("window.originalTitle=document.querySelector('#modal .dialog');window.originalOffset=originalTitle.scrollTop")
        episode.click()
        page.locator("#backStreamDetail").click()
        assert page.locator("#seasonSelect").input_value()=="2"
        assert page.evaluate("document.querySelector('#modal .dialog')===originalTitle && Math.abs(originalTitle.scrollTop-originalOffset)<3")
        assert episode.evaluate("el=>el===document.activeElement")
        page.close()
    browser.close()
