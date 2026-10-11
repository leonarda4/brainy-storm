from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from main import read_transcript


class StormTranscriptTests(unittest.TestCase):
    def test_dated_agent_comments_are_excluded_without_removing_human_timestamps(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "transcript.txt"
            human = "[2026-10-11T14:00:00.000+00:00] [Maya] Build a voice app.\n"
            path.write_text(human + "[2026-10-11T14:01:00.000+00:00] [Agent Storm] Move on.\n")
            self.assertEqual(read_transcript(path)[1], human)

    def test_agent_comments_never_become_idea_context_and_partial_lines_wait(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "transcript.txt"
            path.write_text("[Maya] Build a voice app.\n[Agent Storm] Move on.\n[Storm] I am a human.\n[Alex] Partial")
            identity, text = read_transcript(path)
            self.assertEqual(text, "[Maya] Build a voice app.\n[Storm] I am a human.\n")
            with path.open("a") as file:
                file.write(" thought.\n[Agent Storm] Another reminder.\n")
            new_identity, complete = read_transcript(path)
            self.assertEqual(identity, new_identity)
            self.assertEqual(complete[len(text):], "[Alex] Partial thought.\n")
