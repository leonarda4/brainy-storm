import os
import unittest
from unittest.mock import AsyncMock, patch

from storm import STORM_COMMENT, StormAgent


def verdict(**changes):
    return {"focus": "Choosing a name for the app", "focus_changed": False,
            "progressing": False, "issue": "repetitive", "confidence": 0.95, **changes}


class StormTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.agent = StormAgent("test-key", "test-model")
        self.agent.assess = AsyncMock(return_value=verdict())
        self.agent.observe("word " * 80, 0)

    async def check(self, now, **changes):
        self.agent.observe("new " * 25, now)
        self.agent.assess.return_value = verdict(**changes)
        return await self.agent.check(now)

    async def test_warmup_and_two_checks_then_cooldown(self):
        self.assertIsNone(await self.check(30))
        self.agent.assess.assert_not_awaited()
        self.assertIsNone(await self.check(45))
        self.assertIsNone(await self.check(55))
        self.assertEqual(await self.check(65), {"text": STORM_COMMENT, "reason": "repetitive"})
        self.assertIsNone(await self.check(100))
        self.assertEqual(self.agent.assess.await_count, 2)
        self.assertIsNone(await self.check(185))
        self.assertIsNotNone(await self.check(205))

    async def test_silence_and_unchanged_transcript_do_not_trigger_checks(self):
        self.assertIsNone(await self.agent.check(100))
        self.agent.assess.assert_not_awaited()
        await self.check(101)
        self.assertIsNone(await self.agent.check(122))
        self.assertEqual(self.agent.assess.await_count, 1)

    async def test_productive_deep_dive_and_low_confidence_do_not_interrupt(self):
        for now in [180, 200, 220]:
            self.assertIsNone(await self.check(now, issue="overlong", progressing=True))
        for now in [240, 260]:
            self.assertIsNone(await self.check(now, confidence=0.5))
        self.assertEqual(self.agent.suspicions, 0)

    async def test_overlong_requires_time_budget_and_repeated_evidence(self):
        self.assertIsNone(await self.check(45, issue="overlong"))
        self.assertIsNone(await self.check(65, issue="overlong"))
        self.assertIsNone(await self.check(180, issue="overlong"))
        self.assertIsNotNone(await self.check(200, issue="overlong"))

    async def test_sustained_tangent_interrupts_even_when_unrelated_chat_progresses(self):
        self.assertIsNone(await self.check(45, issue="sidetracked", progressing=True))
        self.assertIsNotNone(await self.check(65, issue="sidetracked", progressing=True))

    async def test_changing_aspect_or_returning_to_focus_clears_pending_intervention(self):
        await self.check(45)
        self.assertIsNone(await self.check(65, focus_changed=True, focus="Testing feasibility", issue="on_track"))
        self.assertIsNone(await self.check(85))
        self.assertIsNone(await self.check(105, issue="on_track"))
        self.assertIsNone(await self.check(125))

    async def test_provider_failure_and_invalid_output_do_not_cut_off_team(self):
        await self.check(45)
        self.agent.observe("new " * 25, 65)
        self.agent.assess.side_effect = RuntimeError("Provider unavailable")
        with self.assertRaises(RuntimeError):
            await self.agent.check(65)
        self.assertEqual(self.agent.suspicions, 0)
        self.agent.assess.side_effect = None
        with self.assertRaises(ValueError):
            await self.check(85, confidence="high")
        self.assertIsNone(await self.check(105))

    async def test_pause_resume_preserves_cooldown_and_reset_clears_it(self):
        await self.check(45)
        await self.check(65)
        self.agent.start()
        self.agent.observe("word " * 100, 70)
        self.assertIsNone(await self.check(115))
        self.assertEqual(self.agent.assess.await_count, 2)
        self.agent.clear()
        self.agent.observe("word " * 100, 120)
        self.assertIsNone(await self.check(165))
        self.assertIsNotNone(await self.check(185))

    async def test_assessment_uses_resolved_speakers_without_duplicating_speech(self):
        self.agent.observe("Hi, it's Leonarda.", 40, "intro")
        self.agent.observe("Let's build a tracker.", 41, "idea")
        self.agent.observe("I agree.", 42, "other")
        words = self.agent.words
        self.agent.attribute(["intro", "idea"], "[Leonarda] Hi, it's Leonarda. Let's build a tracker.")
        self.agent.attribute(["other"], "[Alex] I agree.")
        self.assertEqual(self.agent.words, words)
        await self.check(45)
        conversation = self.agent.assess.call_args.args[0]["conversation"]
        self.assertIn("[Leonarda] Hi, it's Leonarda. Let's build a tracker.\n[Alex] I agree.", conversation)
        self.assertEqual(conversation.count("Let's build a tracker."), 1)

    async def test_late_attribution_cannot_restore_old_focus_evidence(self):
        self.agent.observe("Old discussion.", 40, "old")
        self.agent.start()
        self.agent.observe("New discussion.", 41, "new")
        self.agent.attribute(["old"], "[Leonarda] Old discussion.")
        self.assertEqual(list(self.agent.fragments), [("new", "New discussion.")])

    async def test_disabled_or_missing_credentials_never_call_provider(self):
        for key, enabled in [("", True), ("test-key", False)]:
            self.agent.api_key = key
            self.agent.enabled = enabled
            self.assertIsNone(await self.check(60))
        self.agent.assess.assert_not_awaited()


class StormTestModeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.agent = StormAgent("test-key", "test-model", test_mode=True)
        self.agent.assess = AsyncMock(return_value=verdict(
            focus="Database indexing internals unrelated to the current feature",
            issue="sidetracked", progressing=True, confidence=0.75,
        ))
        self.agent.observe("word " * 40, 0)

    async def check(self, now):
        self.agent.observe("new " * 10, now)
        return await self.agent.check(now)

    async def test_technical_tangent_interrupts_at_one_minute_then_cools_down(self):
        self.assertIsNone(await self.check(59))
        self.agent.assess.assert_not_awaited()
        self.assertEqual(await self.check(60), {"text": STORM_COMMENT, "reason": "sidetracked"})
        self.assertEqual(self.agent.assess.call_args.args[0]["time_budget_seconds"], 60)
        self.assertIsNone(await self.check(120))
        self.assertIsNone(await self.check(179))
        self.assertEqual(self.agent.assess.await_count, 1)
        self.assertIsNotNone(await self.check(180))
        self.assertEqual(self.agent.assess.await_count, 2)

    async def test_stalled_focus_qualifies_at_one_minute(self):
        self.agent.assess.return_value = verdict(issue="overlong")
        self.assertIsNone(await self.check(59))
        self.assertEqual(await self.check(60), {"text": STORM_COMMENT, "reason": "overlong"})

    async def test_needed_explanations_productive_speech_and_uncertainty_do_not_interrupt(self):
        for now, decision in [
            (60, verdict(focus="Explaining why a database limit prevents the feature",
                         issue="on_track", progressing=True)),
            (70, verdict(issue="overlong", progressing=True)),
            (80, verdict(issue="repetitive", progressing=True)),
            (90, verdict(issue="sidetracked", confidence=0.69)),
        ]:
            self.agent.assess.return_value = decision
            self.assertIsNone(await self.check(now))

    async def test_silence_and_unchanged_transcript_still_do_not_trigger(self):
        self.assertIsNone(await self.agent.check(60))
        self.agent.assess.assert_not_awaited()
        self.agent.assess.return_value = verdict(issue="on_track", progressing=True)
        self.assertIsNone(await self.check(61))
        self.assertIsNone(await self.agent.check(71))
        self.assertEqual(self.agent.assess.await_count, 1)

    async def test_pause_preserves_cooldown_and_restart_resets_it(self):
        self.assertIsNotNone(await self.check(60))
        self.agent.start()
        self.agent.observe("word " * 40, 61)
        self.assertIsNone(await self.check(121))
        self.assertEqual(self.agent.assess.await_count, 1)
        self.assertIsNotNone(await self.check(180))
        self.agent.clear()
        self.agent.observe("word " * 40, 181)
        self.assertIsNotNone(await self.check(241))

    def test_environment_flag_is_opt_in_and_can_restore_normal_thresholds(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True):
            self.assertEqual(StormAgent.from_environment().required_checks, 2)
            for value in ["true", "1", " YES "]:
                os.environ["STORM_TEST_MODE"] = value
                agent = StormAgent.from_environment()
                self.assertEqual(agent.required_checks, 1)
                self.assertEqual(agent.max_focus_seconds, 60)
                self.assertEqual(agent.cooldown_seconds, 120)
            os.environ["STORM_TEST_MODE"] = "false"
            agent = StormAgent.from_environment()
            self.assertEqual(agent.required_checks, 2)
            self.assertEqual(agent.max_focus_seconds, 180)
