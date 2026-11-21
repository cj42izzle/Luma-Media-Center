"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=name=>fs.readFileSync(name,"utf8");
const app=read("app.js"),html=read("index.html"),mobile=read("mobile-nav.js"),css=read("mobile-nav.css");
test("phone navigation uses five touch-safe destinations without reusing TV navigation",()=>{
 new vm.Script(mobile);
 const names=[...mobile.matchAll(/\{tab:"([^"]+)",icon:/g)].map(x=>x[1]);
 assert.deepEqual(names,["Home","Catalogs","Live TV","My Library","More"]);
 assert.match(mobile,/aria-expanded/);
 assert.match(mobile,/data-mobile-page/);
 assert.match(css,/#lumaMobileNav/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(css,/min-height:52px/);
 assert.match(css,/html:not\(\[data-tv="true"\]\) .sidebar/);
 assert.match(html,/src="\.\/mobile-nav\.js\?v=1"/);
});
test("search includes source-backed IPTV channels but no synthetic matches",()=>{
 assert.match(app,/function channelSearchMarkup\(query\)/);
 assert.match(app,/LumaIPTV\.channels\(\)/);
 assert.match(app,/\[data-search-channel\]/);
 assert.match(html,/\.\/ux-polish\.css/);
});
test("Android TV uses fixed six-option remote rail and preserves poster-rail navigation",()=>{
 const tv=read("tv-experience.js"),tvcss=read("tv-experience.css"),focus=read("tv.js");
 assert.match(tv,/\["Catalogs","⌕","Discover"\]/);
 assert.match(tv,/\["My Library","▰","My Stuff"\]/);
 assert.match(tvcss,/#lumaTvNav:focus-within/);
 assert.match(tvcss,/position:fixed!important/);
 assert.match(focus,/\.tvExperienceHome \.lumaShelf \.tiles/);
 assert.match(focus,/\.tvNavTab\.active/);
 assert.match(tv,/shelf\("Your Watchlist"/);
 assert.match(tv,/shelf\("Your Favorites"/);
});
test("Home shows library rows ahead of optional weather and news, and details offer next unwatched episode",()=>{
 const home=read("luma-home.js"),start=home.indexOf("function markup(model,shelf)"),end=home.indexOf("function bind()",start);
 const m=home.slice(start,end);
 assert.ok(m.indexOf('shelf("Your Watchlist"')<m.indexOf("weatherMarkup()"));
 assert.ok(m.indexOf('shelf("Your Favorites"')<m.indexOf("newsSection(true)"));
 assert.match(m,/state\.showHomeExtras/);
 assert.match(app,/id="toggleHomeExtras"/);
 assert.match(app,/id="playNextEpisode"/);
 assert.match(app,/watchedCount/);
});
test("player persists audio and subtitle language selection",()=>{
 const player=read("luma-player.js");
 assert.match(player,/preferredAudio/);assert.match(player,/preferredSubtitles/);
 assert.match(player,/savePrefs\(\)/);
 new vm.Script(player);
});
test("native tvOS foundation is present and honest about absent platform parity",()=>{
 for(const name of ["tvos/project.yml","tvos/README.md","tvos/LumaTV/App.swift","tvos/LumaTV/Catalog.swift","tvos/LumaTV/Player.swift"])assert.ok(fs.existsSync(name),name);
 assert.match(read("tvos/LumaTV/App.swift"),/@main/);
 assert.match(read("tvos/LumaTV/App.swift"),/AVPlayer|NativeTVPlayer/);
 assert.match(read("tvos/LumaTV/Player.swift"),/Keychain|SecItemAdd/);
 assert.match(read("tvos/README.md"),/not automatically synced/);
});

test("iPhone Home poster sizing and action-sheet accessibility are scoped away from TV and full Library",()=>{
 const theater=read("theater.css");
 assert.match(theater,/html:not\(\[data-tv="true"\]\) \.lumaHomePage \.lumaCompactShelf \.media/);
 assert.match(theater,/32vw/);
 assert.match(theater,/max-width:140px!important/);
 assert.match(theater,/\.episodeSeasonBulk/);
 assert.match(theater,/\.lumaPosterActionSheet/);
 assert.match(css,/#buildMark\{display:none!important\}/);
 assert.match(theater,/data-open/);
});
