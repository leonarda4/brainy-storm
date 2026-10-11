import unittest

from speakers import AudioBuffer, BYTES_PER_SECOND, SpeakerTracker, UNKNOWN, format_lines, introduction_name


def turn(first, last, voice, start, end, name="", introduction=""):
    return dict(first_word=first, last_word=last, voice=voice, start_s=start, end_s=end,
                name=name, introduction=introduction)


class SpeakerTests(unittest.TestCase):
    def setUp(self):
        self.tracker = SpeakerTracker("test-key", "test-model")
        self.pcm = b"\x01\x00" * (24000 * 12)

    def apply(self, text, turns):
        return self.tracker.apply({"turns": turns}, self.pcm, text.split(), "12:00:00")

    def test_two_introductions_then_returning_voice_without_repeating_name(self):
        lines = self.apply("I'm Maya. Build a kiosk. I'm Alex. Add solar power.", [
            turn(0, 4, "new1", 0, 3, "Maya", "I'm Maya"),
            turn(5, 9, "new2", 4, 8, "Alex", "I'm Alex"),
        ])
        self.assertEqual([line["person"] for line in lines], ["Maya", "Alex"])
        # Recognition must use the supplied audio reference ID, not the name mentioned in text.
        returned = self.apply("Alex makes a good point.", [turn(0, 4, "voice1", 0, 2)])
        self.assertEqual(returned[0]["person"], "Maya")
        self.assertEqual(len(self.tracker.voices), 2)
        self.assertIn("[Maya] I'm Maya.", format_lines(lines))

    def test_name_mention_cannot_name_a_new_voice(self):
        lines = self.apply("I agree with Maya.", [turn(0, 3, "new1", 0, 2, "Maya", "I agree with Maya")])
        self.assertEqual(lines[0]["person"], "Speaker 1")

    def test_each_speaker_turn_keeps_its_captured_time_across_midnight(self):
        before = "2026-10-11T23:59:58.000+00:00"
        after = "2026-10-12T00:00:02.000+00:00"
        lines = self.tracker.apply({"turns": [
            turn(0, 1, "new1", 0, 2, "Maya", "I'm Maya"),
            turn(2, 3, "new2", 4, 6, "Alex", "I'm Alex"),
        ]}, self.pcm, "I'm Maya. I'm Alex.".split(), before, [before, before, after, after])
        self.assertEqual([line['timestamp'] for line in lines], [before, after])
        self.assertEqual(format_lines(lines), f"[{before}] [Maya] I'm Maya.\n[{after}] [Alex] I'm Alex.")

    def test_casual_introduction_names_the_voice_and_all_following_batches(self):
        lines = self.apply("Hi, it's Leonarda. So", [
            turn(0, 3, "new1", 0, 3, "Leonarda", "Hi, it's Leonarda"),
        ])
        self.assertEqual(lines[0]["person"], "Leonarda")
        for text in ("I'm just further explaining", "our brainstorming idea decision tracker."):
            lines = self.apply(text, [turn(0, len(text.split()) - 1, "voice1", 0, 3)])
            self.assertEqual(lines[0]["person"], "Leonarda")
            self.assertTrue(format_lines(lines).startswith("[12:00:00] [Leonarda] "))
        self.assertEqual(len(self.tracker.voices), 1)

    def test_casual_introduction_split_between_batches_names_existing_voice(self):
        self.apply("Hi, it's", [turn(0, 1, "new1", 0, 2)])
        self.tracker.context = "Hi, it's"
        lines = self.apply("Leonarda. So", [turn(0, 1, "voice1", 0, 2, "Leonarda", "Hi, it's Leonarda")])
        self.assertEqual(lines[0]["person"], "Leonarda")

    def test_casual_introduction_after_unpunctuated_context_names_the_new_speaker(self):
        self.tracker.context = "we could build a"
        lines = self.apply("Hi, it's Leonarda. So", [turn(0, 3, "new1", 0, 3, "Leonarda", "it's Leonarda")])
        self.assertEqual(lines[0]["person"], "Leonarda")

    def test_casual_introductions_accept_natural_variants_but_not_name_mentions(self):
        for quote in ("It's Leonarda", "Hi, it’s Leonarda", "Hello, it is Leonarda", "It's Leonarda here"):
            with self.subTest(quote=quote):
                self.assertEqual(introduction_name("Leonarda", quote, quote + ". So"), "Leonarda")
        for text in ("I think it's Leonarda.", "It's Leonarda's idea.", 'She said "it\'s Leonarda".',
                     "It's Leonarda who proposed that."):
            with self.subTest(text=text):
                self.assertEqual(introduction_name("Leonarda", "it's Leonarda", text), "")

    def test_another_speakers_introduction_cannot_name_this_voice(self):
        lines = self.apply("I'm Maya. That works.", [
            turn(0, 1, "new1", 0, 2, "Maya", "I'm Maya"),
            turn(2, 3, "new2", 3, 5, "Maya", "I'm Maya"),
        ])
        self.assertEqual([line["person"] for line in lines], ["Maya", "Speaker 2"])

    def test_introduction_split_between_batches_names_existing_voice(self):
        self.apply("Hi my name is", [turn(0, 3, "new1", 0, 2)])
        self.tracker.context = "Hi my name is"
        lines = self.apply("Zoë. I like this.", [turn(0, 3, "voice1", 0, 2, "Zoë", "my name is Zoë")])
        self.assertEqual(lines[0]["person"], "Zoë")

    def test_multiple_turns_can_share_a_new_voice_and_later_introduction(self):
        lines = self.apply("Hello. Hi. I'm Maya.", [
            turn(0, 0, "new1", 0, 1), turn(1, 1, "new2", 2, 3),
            turn(2, 3, "new1", 4, 6, "Maya", "I'm Maya"),
        ])
        self.assertEqual([line["person"] for line in lines], ["Maya", "Speaker 2", "Maya"])

    def test_introduction_wholly_in_previous_batch_does_not_name_a_new_voice(self):
        self.tracker.context = "I'm Maya."
        lines = self.apply("I agree.", [turn(0, 1, "new1", 0, 2, "Maya", "I'm Maya")])
        self.assertEqual(lines[0]["person"], "Speaker 1")

    def test_ambiguous_or_overlapping_voices_are_not_enrolled(self):
        lines = self.apply("Yes. No.", [turn(0, 0, "new1", 0, 2), turn(1, 1, "new2", 1, 3)])
        self.assertEqual(lines[0]["person"], UNKNOWN)
        self.assertEqual(lines[0]["text"], "Yes. No.")
        self.assertEqual(self.tracker.voices, {})
        self.assertEqual(self.apply("Hmm.", [turn(0, 0, "unknown", 0, 0.2)])[0]["person"], UNKNOWN)

    def test_invalid_response_does_not_partially_enroll_or_drop_words(self):
        for turns in ([turn(0, 0, "new1", 0, 1)],
                      [turn(0, 0, "new1", 0, 1), turn(0, 1, "new2", 2, 3)],
                      [turn(0, 1, "voice999", 0, 1)],
                      [turn(0, 1, "new1", 0, 100)],
                      [turn(0, 1, "new1", float("nan"), 3)]):
            with self.assertRaises(ValueError):
                self.apply("Hi there.", turns)
            self.assertEqual(self.tracker.voices, {})

    def test_reset_discards_voice_references_and_name_context(self):
        self.apply("I'm Maya.", [turn(0, 1, "new1", 0, 2, "Maya", "I'm Maya")])
        self.tracker.context = "I'm Maya."
        self.tracker.clear()
        self.assertEqual(self.tracker.voices, {})
        self.assertEqual(self.tracker.context, "")
        self.assertEqual(self.tracker.next_speaker, 1)

    def test_audio_window_stays_bounded_and_crops_using_absolute_timestamps(self):
        audio = AudioBuffer()
        audio.append(b"\x01\x00" * (24000 * 95))
        self.assertEqual(audio.duration, 95)
        self.assertEqual(len(audio.data), 90 * BYTES_PER_SECOND)
        start, clip = audio.clip(94, 96)
        self.assertEqual(start, 94)
        self.assertEqual(len(clip), BYTES_PER_SECOND)
        start, clip = audio.clip(0, 6)
        self.assertEqual(start, 5)
        self.assertEqual(len(clip), BYTES_PER_SECOND)

    def test_literal_introductions_support_unicode_and_reject_invented_evidence(self):
        for name, quote in [("Zoë", "I’m Zoë"), ("Jean-Luc", "My name is Jean-Luc"), ("Asha Patel", "Asha Patel here")]:
            self.assertEqual(introduction_name(name, quote, quote + ". Hello."), name)
        self.assertEqual(introduction_name("Maya", "I'm Maya", "I'm Alex."), "")
        self.assertEqual(introduction_name("Maya]\n[Alex", "I'm Maya", "I'm Maya"), "")


if __name__ == "__main__":
    unittest.main()
