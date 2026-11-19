import json
import unittest
from unittest.mock import patch
import xtream
import recorder as r

class XtreamTests(unittest.TestCase):
    source = {"id": "provider-b", "type":"xtream", "name":"Authorized TV",
              "server":"https://tv.example.org:443","username":"viewer","password":"hidden-key",
              "output":"m3u8"}
    def fetch(self, url, limit):
        if "get_live_categories" in url:
            return json.dumps([{"category_id":"11","category_name":"Sports"}])
        if "get_live_streams" in url:
            return json.dumps([{"stream_id":101,"name":"ESPN HD","epg_channel_id":"espn.us",
                                "stream_icon":"https://art.example.org/espn.png",
                                "num":30,"category_id":"11"}])
        if "get_vod_streams" in url:
            return json.dumps([{"stream_id":22,"name":"The Matrix (1999)", "container_extension":"mp4"}])
        if "action=get_series&" in url or url.endswith("action=get_series"):
            return json.dumps([{"series_id":7,"name":"Example Show","releaseDate":"2024-04-18"}])
        if "get_series_info" in url:
            return json.dumps({"episodes":{"2":[{"id":707,"episode_num":5,"container_extension":"mp4"}]}})
        raise AssertionError("Unexpected fetch "+url)
    def test_authorized_xtream_catalog_and_private_credentials(self):
        channels, vod, series = xtream.load_catalog(self.source,self.fetch)
        self.assertEqual(len(channels),1)
        self.assertEqual(channels[0]["group"],"Sports")
        self.assertEqual(channels[0]["epg_id"],"espn.us")
        self.assertIn("/live/viewer/hidden-key/101.m3u8", channels[0]["url"])
        self.assertEqual(len(vod),1)
        self.assertIn("/movie/viewer/hidden-key/22.mp4",vod[0]["url"])
        self.assertEqual(len(series),1)
        eps=xtream.episode_matches(self.source,series,{"title":"Example Show","type":"series","season":"2","episode":"5"},self.fetch)
        self.assertEqual(len(eps),1)
        self.assertIn("/series/viewer/hidden-key/707.mp4",eps[0]["url"])
        self.assertEqual(xtream.episode_matches(self.source,series,{"title":"Example Show","type":"series","season":"2","episode":"6"},self.fetch),[])
    def test_url_validation(self):
        for server in ("file:///tmp/playlist", "http://bad.example.com/?token=x",
                       "https://user:pass@somewhere.example/"):
            with self.assertRaises(ValueError):
                xtream.panel_url(server)
    def test_xmltv_provider_link_is_explicit(self):
        url=xtream.epg_url(self.source["server"],self.source["username"],self.source["password"])
        self.assertIn("/xmltv.php?username=viewer&password=hidden-key",url)
    def test_all_providers_preserved_if_one_guide_is_unavailable(self):
        original=[x.copy() for x in r.STATE["sources"]]
        old_channels=r.CHANNELS;old_vod=r.VOD;old_series=r.SERIES;old_programs=r.PROGRAMS
        old_refresh=r.NEXT_REFRESH
        try:
            r.STATE["sources"]=[
                {"id":"provider-a","name":"M3U Provider","type":"m3u","m3u_url":"https://m3u.example/list","xmltv_url":""},
                self.source.copy()]
            def feed(url,limit):
                if url=="https://m3u.example/list":
                    return '#EXTM3U\n#EXTINF:-1 tvg-id="espn.us" group-title="Sports",ESPN\nhttps://m3u.example/play/1.ts\n'
                if "xmltv.php" in url:
                    raise ValueError("EPG temporarily unavailable")
                return self.fetch(url,limit)
            with patch.object(r,"fetch_feed",side_effect=feed),patch.object(r,"save_state"):
                r.refresh_guide()
            self.assertEqual(len(r.CHANNELS),2)
            self.assertEqual(len({x["provider"] for x in r.CHANNELS}),2)
            self.assertEqual(len(r.VOD),1)
            self.assertEqual(len(r.SERIES),1)
        finally:
            r.STATE["sources"]=original
            r.CHANNELS=old_channels;r.VOD=old_vod;r.SERIES=old_series;r.PROGRAMS=old_programs
            r.NEXT_REFRESH=old_refresh

if __name__=="__main__":
    unittest.main()
