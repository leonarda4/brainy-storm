import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.enrichment.models import Idea
from backend.enrichment.stance_participants import clean_participant_attributions
from backend.enrichment.storage import StorageManager
from backend.enrichment.tools.pros_cons_agent import pros_cons_agent, llm_client

PLACEHOLDER = "Minimalist opposition (Giacomo's view implies skepticism toward complex tooling)"


class StanceParticipantTests(unittest.IsolatedAsyncioTestCase):
    def test_absent_and_descriptive_opposition_are_empty(self):
        self.assertEqual(clean_participant_attributions([
            PLACEHOLDER, 'No opposition', 'None: No objections.',
            'Technical skeptics: Worried about complexity.', 'General consensus', '', None,
        ]), [])
        self.assertEqual(Idea(title='Decision tracker', opponents=[PLACEHOLDER]).opponents, [])

    def test_real_named_attributions_and_numbered_speakers_remain(self):
        people = [
            'Alex expressed clear personal support for the concept.',
            'Marko contends conversational AI helps participants.',
            'Leonarda (Designer): Supports testing.',
            'Zoë O’Connor: Opposes the consensus.',
            'Speaker 4 (questions feasibility)',
        ]
        self.assertEqual(clean_participant_attributions(people), people)

    async def test_model_output_and_late_saves_cannot_restore_placeholder_people(self):
        idea = Idea(id='tracker', title='Decision tracker', proponents=['Leonarda'])
        # Reproduce old data or an in-flight response from before the fix.
        idea.opponents = [PLACEHOLDER]
        with patch.object(llm_client, 'generate_json', AsyncMock(return_value={
            'proponents': ['Leonarda'], 'opponents': [PLACEHOLDER, 'No opposition'],
        })):
            _, supporters, opponents = await pros_cons_agent.run(idea, 'Leonarda: This is useful.')
        self.assertEqual(supporters, ['Leonarda'])
        self.assertEqual(opponents, [])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            await store.save_or_update_idea(idea)
            self.assertEqual((await store.get_idea('tracker')).opponents, [])
