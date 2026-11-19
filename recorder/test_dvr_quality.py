import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import recorder as r
from dvr_quality import select_rerun, verify_capture, compress_verified, hevc_command


class QualityAndRerunTests(unittest.TestCase):
    def setUp(self):
        self.now = int(datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)

    def programme(self, cid, episode, when, quality=0, title="Example Series", desc="A crew uncovers a missing map under the lighthouse"):
        return dict(id=cid+str(when), channel_id=cid, title=title, episode=episode, subtitle="",
                    description=desc, is_new=False, rerun=True, start=when, end=when+1800000)

    def test_retry_finds_exact_episode_on_different_provider_same_day(self):
        original=self.programme("provider-a", "S02E05", self.now-3600000)
        original["episode_key"]=r.exact_episode_key(original)
        next_episode=self.programme("provider-b", "S02E06", self.now+60000)
        exact=self.programme("provider-c", "S02E05", self.now+120000)
        later=self.programme("provider-a", "S02E05", self.now+3600000)
        channels={"provider-a":{"quality":1},"provider-b":{"quality":2},"provider-c":{"quality":0}}
        candidate=select_rerun(original,[next_episode,later,exact],channels,
                               {original["id"]},r.exact_episode_key,self.now)
        self.assertEqual(candidate["id"],exact["id"])
        self.assertEqual(candidate["channel_id"],"provider-c")

    def test_never_substitute_wrong_season_or_ambiguous_description(self):
        original=self.programme("a","S04E09",self.now-3600000)
        original["episode_key"]=r.exact_episode_key(original)
        different=self.programme("b","S04E10",self.now+3600000)
        self.assertIsNone(select_rerun(original,[different],{"b":{"quality":2}},set(),r.exact_episode_key,self.now))
        ambiguous=dict(title="Mystery",episode="",subtitle="",description="Tonight")
        self.assertEqual(r.exact_episode_key(ambiguous),"")

    def test_source_across_channel_records_live_retry_job(self):
        base=self.programme("source-1","S02E05",self.now-3600000)
        airing=self.programme("source-2","S02E05",self.now+90000)
        wrong=self.programme("source-3","S02E06",self.now+60000)
        original=dict(id="failed-1",program_id=base["id"],channel_id=base["channel_id"],title=base["title"],
                      episode=base["episode"],subtitle="",description=base["description"],
                      episode_key=r.exact_episode_key(base),status="partial",start=base["start"],end=base["end"],
                      error="Lost 20 minutes",file="partial.ts")
        old_jobs=r.STATE["jobs"]
        old_programs=r.PROGRAMS
        old_channels=r.CHANNELS
        try:
            r.STATE["jobs"]=[original]
            r.PROGRAMS=[wrong,airing]
            r.CHANNELS=[{"id":"source-2","quality":0},{"id":"source-3","quality":2}]
            with patch("recorder.time.time",return_value=self.now/1000),patch("recorder.save_state"):
                r.queue_failed_episode_retries()
                self.assertEqual(len(r.STATE["jobs"]),2)
                retry=r.STATE["jobs"][1]
                self.assertEqual(retry["channel_id"],"source-2")
                self.assertEqual(retry["retry_root"],"failed-1")
                self.assertEqual(retry["retry_attempt"],1)
                r.queue_failed_episode_retries()
                self.assertEqual(len(r.STATE["jobs"]),2)
        finally:
            r.STATE["jobs"]=old_jobs
            r.PROGRAMS=old_programs
            r.CHANNELS=old_channels

    def test_short_media_never_passes_as_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"capture.ts";file.write_bytes(b"x"*8192)
            job={"start":self.now,"end":self.now+1800000}
            good,error=verify_capture(job,file,0,self.now/1000,
                                      lambda p:{"duration":600,"codec":"h264"})
            self.assertFalse(good);self.assertIn("Incomplete",error)
            good,error=verify_capture(job,file,0,self.now/1000,
                                      lambda p:{"duration":1790,"codec":"h264"})
            self.assertTrue(good)
            good,error=verify_capture(job,file,0,(self.now+180000)/1000,
                                      lambda p:{"duration":1800,"codec":"h264"})
            self.assertFalse(good);self.assertIn("started after",error)

    def test_true_libx265_encoding_command_and_safe_fallback(self):
        command=hevc_command("original.ts","new.mp4",27,"fast")
        self.assertIn("libx265",command)
        self.assertIn("hvc1",command)
        self.assertIn("+faststart",command)
        with tempfile.TemporaryDirectory() as tmp:
            original=Path(tmp)/"source.ts";original.write_bytes(b"x"*50000)
            def inspect(path):
                return {"duration":1800,"codec":"hevc" if str(path).endswith(".pending.mp4") else "h264"}
            def execute(args,**kwargs):
                Path(args[-1]).write_bytes(b"y"*17000)
                return SimpleNamespace(returncode=0)
            output,saved,state=compress_verified(original,inspect=inspect,execute=execute)
            self.assertEqual(state,"hevc_complete")
            self.assertEqual(saved,33000)
            self.assertTrue(output.is_file())
            self.assertTrue(original.is_file(),"Do not delete the input inside the converter")
            failure,saved,state=compress_verified(original,inspect=inspect,execute=lambda *a,**kw:SimpleNamespace(returncode=1))
            self.assertEqual(failure,original)
            self.assertEqual(state,"hevc_failed_original_kept")
            self.assertTrue(original.is_file())


if __name__=="__main__":
    unittest.main()
