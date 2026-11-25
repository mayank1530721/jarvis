import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-agent"))
import clipper

VTT = """WEBVTT

00:00:01.000 --> 00:00:03.000
hello <c>there</c>

00:00:03.000 --> 00:00:05.000
hello there

00:00:25.000 --> 00:00:28.000
second part
"""


class ClipperTests(unittest.TestCase):
    def test_vtt_groups_and_dedupes(self):
        out = clipper.parse_vtt(VTT)
        self.assertEqual(out.splitlines(), ["[00:01] hello there", "[00:25] second part"])

    def test_segments_validated(self):
        ok = clipper.validate_segments([{"start": 10, "end": 40, "name": "a b!"}])
        self.assertEqual(ok, [(10.0, 40.0, "a_b")])
        for bad in ([], [{"start": 0, "end": 2}], [{"start": 0, "end": 400}], [{"start": "x", "end": 9}],
                    [{"start": 0, "end": 9}] * 9):
            with self.assertRaises(clipper.ClipError):
                clipper.validate_segments(bad)

    def test_commands(self):
        c = clipper.cut_cmd("s.mp4", "d.mp4", 1, 31, True)
        self.assertIn("crop=ih*9/16:ih,scale=1080:1920", c)
        self.assertNotIn("-vf", clipper.cut_cmd("s", "d", 1, 31, False))
        self.assertIn("ytsearch3:cats", clipper.search_cmd("cats", 3))
        self.assertIn("EgIwAQ", clipper.search_cmd("cats", 3, True)[-1])
        with self.assertRaises(clipper.ClipError):
            clipper.search_cmd("  ")


if __name__ == "__main__":
    unittest.main()
