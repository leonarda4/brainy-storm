import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from backend.enrichment.models import Idea
from backend.enrichment.storage import StorageManager

main = importlib.import_module('backend.enrichment.main')


class DiscussionFocusTests(unittest.IsolatedAsyncioTestCase):
    async def test_classified_focus_switches_clears_and_stays_in_its_storm(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            for idea_id, session in [('product', 'a'), ('networking', 'a'), ('other', 'b')]:
                await store.save_or_update_idea(Idea(id=idea_id, title=idea_id, session_id=session))
            await store.set_discussion_focus('b', 'other')
            # Even an already-known idea with no new enrichment context can be focused.
            with patch.object(main, 'storage', store), patch.object(
                main.orchestrator, 'prepare_classified_match', AsyncMock(return_value=None)
            ):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                    for focused in ['product', 'networking', None]:
                        response = await client.post('/transcript/classified-chunks', json={
                            'chunks': [{'session_id': 'a', 'chunk': 'Current discussion', 'ideas': [
                                {'id': focused, 'title': focused, 'is_currently_discussed': True}
                            ] if focused else []}],
                        })
                        self.assertEqual(response.status_code, 200, response.text)
                        ideas = (await client.get('/ideas')).json()
                        self.assertEqual({idea['id'] for idea in ideas if idea['is_currently_discussed']},
                                         {focused, 'other'} if focused else {'other'})

    async def test_focus_survives_new_ideas_late_enrichment_and_storage_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            await store.save_or_update_idea(Idea(id='old', title='Old', session_id='a'))
            await store.set_discussion_focus('a', 'old')
            stale = await store.get_idea('old')
            await store.set_discussion_focus('a', 'new')
            await store.save_or_update_idea(Idea(id='new', title='New', session_id='a'))
            stale.summary = 'Late enrichment'
            await store.save_or_update_idea(stale)
            reopened = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            self.assertEqual([idea.id for idea in await reopened.get_all_ideas() if idea.is_currently_discussed], ['new'])
            stale_new = await reopened.get_idea('new')
            await reopened.set_discussion_focus('a', None)
            await reopened.save_or_update_idea(stale_new)
            self.assertFalse(any(idea.is_currently_discussed for idea in await reopened.get_all_ideas()))

    async def test_multiple_flags_choose_only_the_last_idea(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            for idea_id in ['first', 'last']:
                await store.save_or_update_idea(Idea(id=idea_id, title=idea_id))
            with patch.object(main, 'storage', store), patch.object(
                main.orchestrator, 'prepare_classified_match', AsyncMock(return_value=None)
            ):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                    response = await client.post('/transcript/classified-chunks', json={'chunks': [{
                        'chunk': 'Discuss first, then last.',
                        'ideas': [{'id': idea_id, 'title': idea_id, 'is_currently_discussed': True} for idea_id in ['first', 'last']],
                    }]})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual([idea.id for idea in await store.get_all_ideas() if idea.is_currently_discussed], ['last'])
