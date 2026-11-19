import unittest
import recorder as recorder_module
from unittest.mock import patch
from datetime import datetime, timezone
from recorder import merge_epg_programs, parse_m3u, parse_xmltv, epg_catalog, xml_time, ep_number, match_series, episode_identity, series_record_id, create_job, STATE, vod_entry, vod_matches, Handler

M3U = '''#EXTM3U
#EXTINF:-1 tvg-id="news.us" tvg-name="News HD" group-title="Live",News HD
https://example.com/news/index.m3u8
#EXTINF:-1 tvg-id="movie.us" group-title="Movies",Movies 4K
https://example.com/movies
'''
XML = '''<tv><channel id="news.us"><display-name>News HD</display-name></channel>
<programme channel="news.us" start="20261118160000 -0800" stop="20261118170000 -0800">
<title>Evening News</title><new/><episode-num system="xmltv_ns">1.4.</episode-num></programme>
<programme channel="news.us" start="20261118170000 -0800" stop="20261118180000 -0800">
<title>Evening News</title><previously-shown/></programme></tv>'''

class RecorderTests(unittest.TestCase):
    def test_m3u(self):
        rows=parse_m3u(M3U)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["epg_id"],"news.us")
        self.assertEqual(rows[1]["quality"],2)
    def test_xmltv_dates_and_series(self):
        channels=parse_m3u(M3U)
        with patch("recorder.time.time",return_value=datetime(2026,11,18,12,0,tzinfo=timezone.utc).timestamp()):
            programs=parse_xmltv(XML,channels)
        self.assertEqual(len(programs),2)
        self.assertEqual(programs[0]["episode"],"S02E05")
        self.assertTrue(programs[0]["is_new"])
        self.assertTrue(programs[1]["rerun"])
        rule={"channel_id":channels[0]["id"],"title":"Evening News","mode":"new"}
        self.assertTrue(match_series(rule,programs[0]))
        self.assertFalse(match_series(rule,programs[1]))
        rule["mode"]="all"
        self.assertTrue(match_series(rule,programs[1]))
        rule["mode"]="unseen"
        self.assertFalse(match_series(rule,programs[1]))  # no episode identity or descriptive metadata
    def test_descriptions_enable_unique_episode_dedup_without_claiming_new(self):
        base={"channel_id":"channel-a","title":"Example Show","episode":"","subtitle":"","description":"The crew visits an abandoned lighthouse and uncovers a map in the basement.","is_new":False,"rerun":True,"start":1000,"end":2000000000000,"id":"airing-1"}
        rule={"id":"rule-1","channel_id":"channel-a","title":"Example Show","mode":"unseen"}
        same={**base,"id":"airing-2","description":"The crew visits an abandoned lighthouse and uncovers a map in the basement.","start":3000}
        distinct={**base,"id":"airing-3","description":"The crew meets a new ship captain and tries to recover a stolen antique compass.","start":3000}
        self.assertTrue(episode_identity(base).startswith("metadata:"))
        self.assertEqual(series_record_id(rule,base),series_record_id(rule,same))
        self.assertNotEqual(series_record_id(rule,base),series_record_id(rule,distinct))
        self.assertTrue(match_series(rule,base))
        with patch("recorder.time.time",return_value=0):
            backup=STATE["jobs"]
            try:
                STATE["jobs"]=[]
                first=create_job(base,rule)
                self.assertIsNotNone(first)
                self.assertIsNone(create_job(same,rule))
                self.assertIsNotNone(create_job(distinct,rule))
                rule["mode"]="all"
                self.assertIsNotNone(create_job({**same,"id":"airing-4"},rule))
            finally:
                STATE["jobs"]=backup
        rule["mode"]="new"
        self.assertFalse(match_series(rule,base))

    def test_unseen_requires_identifiable_episode(self):
        episode={"episode":"","subtitle":"","description":"Tonight.","channel_id":"a","title":"Series","is_new":False,"rerun":True}
        self.assertEqual(episode_identity(episode),"")
        rule={"id":"r","channel_id":"a","title":"Series","mode":"unseen"}
        self.assertFalse(match_series(rule,episode))
        rule["mode"]="all"
        self.assertTrue(match_series(rule,episode))

    def test_manual_record_endpoint_exists_and_checks_connected_channel(self):
        import inspect
        code = inspect.getsource(Handler.do_POST)
        self.assertIn('"/recordings/manual"', code)
        self.assertIn('Choose a channel from the connected playlist', code)
        self.assertIn('min(240', code)

    def test_iptv_vod_exact_movie_and_episode_lookup(self):
        m3u="""#EXTM3U
#EXTINF:-1 group-title="Movies",The Matrix (1999) 4K
https://example.org/movie/33.mp4
#EXTINF:-1 group-title="Series",Another Show S02E05 HD
https://example.org/series/3/5
"""
        items=[vod_entry(row) for row in parse_m3u(m3u)]
        self.assertEqual(items[0]["type"],"movie")
        self.assertEqual(items[1]["type"],"series")
        self.assertEqual(len(vod_matches(items,{"title":"The Matrix","year":"1999","type":"movie"})),1)
        self.assertEqual(len(vod_matches(items,{"title":"Another Show","type":"series","season":2,"episode":5})),1)
        self.assertFalse(vod_matches(items,{"title":"Another Show","type":"series","season":2,"episode":6}))
    def test_separate_sources_and_bad_guide_keep_live_channels(self):
        one="""#EXTM3U
#EXTINF:-1 tvg-id="one",News One
https://example.org/live/1.m3u8
#EXTINF:-1 group-title="Movies",Film One (2025) 4K
https://example.org/movie/one.mp4
"""
        two="""#EXTM3U
#EXTINF:-1 tvg-id="two",News Two
https://example.org/live/2.m3u8
"""
        before=[s.copy() for s in recorder_module.STATE["sources"]]
        original_channels=recorder_module.CHANNELS
        original_vod=recorder_module.VOD
        original_programs=recorder_module.PROGRAMS
        try:
            recorder_module.STATE["sources"]=[
                {"id":"p1","name":"Provider One","m3u_url":"https://example.org/one","xmltv_url":""},
                {"id":"p2","name":"Provider Two","m3u_url":"https://example.org/two","xmltv_url":"https://example.org/badguide"}]
            def fetch(url,limit):
                if url.endswith("/one"):return one
                if url.endswith("/two"):return two
                return "<tv>broken"
            with patch.object(recorder_module,"fetch_feed",side_effect=fetch):
                recorder_module.refresh_guide()
            self.assertEqual(len(recorder_module.CHANNELS),2)
            self.assertEqual(len(recorder_module.VOD),1)
            self.assertEqual(recorder_module.VOD[0]["provider"],"Provider One")
            self.assertEqual(recorder_module.CHANNELS[1]["provider"],"Provider Two")
            recorder_module.STATE["sources"]=[]
            recorder_module.refresh_guide()
            self.assertEqual(len(recorder_module.CHANNELS),0)
        finally:
            recorder_module.STATE["sources"]=before
            recorder_module.CHANNELS=original_channels
            recorder_module.VOD=original_vod
            recorder_module.PROGRAMS=original_programs
    def test_alternate_episode_names_and_international_titles(self):
        m3u="""#EXTM3U
#EXTINF:-1 group-title="Series",Café Adventures 2x05 HD
https://example.org/series/cafe/5
#EXTINF:-1 group-title="Series",Another Show Season 2 Episode 7
https://example.org/series/show/7
"""
        rows=[vod_entry(x) for x in parse_m3u(m3u)]
        self.assertEqual(len(vod_matches(rows,{"title":"Café Adventures","type":"series","season":2,"episode":5})),1)
        self.assertEqual(len(vod_matches(rows,{"title":"Another Show","type":"series","season":2,"episode":7})),1)
        self.assertFalse(vod_matches(rows,{"title":"Another Show","type":"series","season":2,"episode":6}))

    def test_epg_catalog_and_explicit_channel_override(self):
        guide='''<tv><channel id="epg.green"><display-name>World News</display-name></channel>
<programme channel="epg.green" start="20261118160000 -0800" stop="20261118170000 -0800">
<title>Independent Guide Show</title><new/></programme></tv>'''
        rows=epg_catalog(guide)
        self.assertEqual(rows, [{"id":"epg.green","name":"World News"}])
        station={"id":"provider:station", "name":"My Different Station","epg_id":"epg.green","quality":2}
        with patch("recorder.time.time",return_value=datetime(2026,11,18,12,0,tzinfo=timezone.utc).timestamp()):
            progs=parse_xmltv(guide,[station],strict=True,assign_all=True)
        self.assertEqual(len(progs),1)
        self.assertEqual(progs[0]["channel_id"],"provider:station")
        self.assertEqual(progs[0]["title"],"Independent Guide Show")

    def test_epg_multiple_station_overrides(self):
        guide='''<tv><channel id="single.feed"><display-name>Feed</display-name></channel>
<programme channel="single.feed" start="20261118160000 -0800" stop="20261118170000 -0800">
<title>Simulcast</title></programme></tv>'''
        mapped=[{"id":"ch1","name":"HD Feed","epg_id":"single.feed","quality":2},
                {"id":"ch2","name":"SD Feed","epg_id":"single.feed","quality":0}]
        with patch("recorder.time.time",return_value=datetime(2026,11,18,12,0,tzinfo=timezone.utc).timestamp()):
            rows=parse_xmltv(guide,mapped,strict=True,assign_all=True)
        self.assertEqual({p["channel_id"] for p in rows},{"ch1","ch2"})

    def test_xmltv_live_and_new_flags_require_explicit_metadata(self):
        xml='''<tv><channel id="demo"><display-name>Demo</display-name></channel>
        <programme channel="demo" start="20261118160000 -0800" stop="20261118170000 -0800">
        <title>Championship Final</title><live/><new/></programme></tv>'''
        channel={"id":"p1","name":"Demo","epg_id":"demo","quality":1}
        with patch("recorder.time.time",return_value=datetime(2026,11,18,12,0,tzinfo=timezone.utc).timestamp()):
            rows=parse_xmltv(xml,[channel])
        self.assertTrue(rows[0]["is_live_event"])
        self.assertTrue(rows[0]["is_new"])
        provider={**rows[0],"is_new":False,"rerun":True,"is_live_event":False}
        merged=merge_epg_programs([provider],rows)
        self.assertEqual(len(merged),1)
        self.assertTrue(merged[0]["is_live_event"])
        self.assertFalse(merged[0]["is_new"])

    def test_multi_epg_fills_missing_channel_without_replacing_guide(self):
        a={"id":"main","channel_id":"a","title":"Known Show","start":1000000,"end":2800000,"is_new":True}
        b={"id":"wrong","channel_id":"a","title":"Different Show","start":1000000,"end":2800000}
        c={"id":"new","channel_id":"b","title":"Another Show","start":1000000,"end":2800000}
        joined=merge_epg_programs([a],[b,c])
        self.assertEqual(len(joined),2)
        self.assertEqual({x["title"] for x in joined},{"Known Show","Another Show"})

    def test_utc_conversion(self):
        self.assertEqual(xml_time("20261118160000 -0800"),int(datetime(2026,11,19,0,0,tzinfo=timezone.utc).timestamp()*1000))
    def test_reject_entities(self):
        with self.assertRaises(ValueError):
            parse_xmltv("<!DOCTYPE tv [<!ENTITY x 'evil'>]><tv/>",parse_m3u(M3U))
    def test_iptv_catalog_merges_movie_providers_and_omits_private_stream_urls(self):
        movie = {"type": "movie", "title": "Fictional Film", "year": "2025",
                 "url": "https://secret.example/movie/private-key/21.mp4"}
        catalog = recorder_module.vod_catalog_metadata(
            [{**movie, "provider_id": "one"}, {**movie, "provider_id": "two"}],
            [{"id": 42, "name": "Fictional Series", "year": "2026", "provider_id": "one"}],
            [{"id": "one", "name": "Provider A"}, {"id": "two", "name": "Provider B"}])
        self.assertEqual(catalog["total"], 2)
        movie_record = next(x for x in catalog["items"] if x["type"] == "Movie")
        self.assertEqual(movie_record["providers"], ["Provider A", "Provider B"])
        self.assertEqual(len(movie_record["sources"]), 2)
        self.assertNotIn("private-key", str(catalog))
        self.assertNotIn("secret.example", str(catalog))
        episode_record = next(x for x in catalog["items"] if x["type"] == "Series")
        self.assertEqual(episode_record["sources"][0]["series_id"], "42")
        filtered = recorder_module.vod_catalog_metadata(
            [movie], [], [{"id": "one", "name": "Provider A"}],
            kind="movie", title_query="fiction", offset=0, limit=10)
        self.assertEqual(filtered["total"], 0)  # Provider missing from example movie.

    def test_xtream_episodes_expose_numbers_and_titles_only(self):
        response = {"episodes": {"1": [
            {"episode_num": 1, "title": "The Arrival", "id": 811, "direct_source": "https://secret.example/episode"},
            {"episode_num": 2, "title": "The Return", "id": 812}],
            "2": [{"episode_num": 1, "title": "New Season", "id": 901}]}}
        with patch("recorder.xtream_request_json", return_value=response):
            rows = recorder_module.xtream_series_episode_catalog(
                {"id": "demo", "username": "private-user", "password": "private-password"}, "50")
        self.assertEqual([(x["season"], x["number"]) for x in rows], [(1, 1), (1, 2), (2, 1)])
        self.assertNotIn("private-password", str(rows))
        self.assertNotIn("secret.example", str(rows))
        self.assertNotIn("direct_source", str(rows))

if __name__ == "__main__":
    unittest.main()
