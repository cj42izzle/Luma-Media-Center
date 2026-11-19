import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from recorder import parse_m3u, parse_xmltv, xml_time, ep_number, match_series

M3U = '''#EXTM3U
#EXTINF:-1 tvg-id="news.us" tvg-name="News HD" group-title="Live",News HD
https://example.com/news/index.m3u8
#EXTINF:-1 tvg-id="movie.us" group-title="Movies",Movies 4K
https://example.com/movies
'''
XML = '''<tv><channel id="news.us"><display-name>News HD</display-name></channel>
<programme channel="news.us" start="20991118160000 -0800" stop="20991118170000 -0800">
<title>Evening News</title><new/><episode-num system="xmltv_ns">1.4.</episode-num></programme>
<programme channel="news.us" start="20991118170000 -0800" stop="20991118180000 -0800">
<title>Evening News</title><previously-shown/></programme></tv>'''

class RecorderTests(unittest.TestCase):
    def test_m3u(self):
        rows=parse_m3u(M3U)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["epg_id"],"news.us")
        self.assertEqual(rows[1]["quality"],2)
    def test_xmltv_dates_and_series(self):
        channels=parse_m3u(M3U)
        with patch("recorder.time.time",return_value=0):
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
        self.assertFalse(match_series(rule,programs[1]))
    def test_utc_conversion(self):
        self.assertEqual(xml_time("20261118160000 -0800"),int(datetime(2026,11,19,0,0,tzinfo=timezone.utc).timestamp()*1000))
    def test_reject_entities(self):
        with self.assertRaises(ValueError):
            parse_xmltv("<!DOCTYPE tv [<!ENTITY x 'evil'>]><tv/>",parse_m3u(M3U))
if __name__ == "__main__":
    unittest.main()
