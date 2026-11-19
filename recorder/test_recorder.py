import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from recorder import parse_m3u, parse_xmltv, xml_time, ep_number, match_series, episode_identity, series_record_id, create_job, STATE, Handler

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

    def test_utc_conversion(self):
        self.assertEqual(xml_time("20261118160000 -0800"),int(datetime(2026,11,19,0,0,tzinfo=timezone.utc).timestamp()*1000))
    def test_reject_entities(self):
        with self.assertRaises(ValueError):
            parse_xmltv("<!DOCTYPE tv [<!ENTITY x 'evil'>]><tv/>",parse_m3u(M3U))
if __name__ == "__main__":
    unittest.main()
