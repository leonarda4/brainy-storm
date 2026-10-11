import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend.enrichment.job_queue import EnrichmentJobQueue
from backend.enrichment.models import Idea, RoutedIdeaMatch
from backend.enrichment.storage import StorageManager

main = importlib.import_module('backend.enrichment.main')
queue_module = importlib.import_module('backend.enrichment.job_queue')


class ProjectTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_titles_and_late_jobs_remain_in_their_own_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = StorageManager(root / 'ideas.json', root / 'transcript.txt')
            queue = EnrichmentJobQueue()
            with patch.object(queue_module, 'storage', store), patch.object(main, 'storage', store):
                for project in ('a', 'b'):
                    job = await queue.enqueue('chunk-' + project, 'Context for ' + project, RoutedIdeaMatch(
                        idea_id='idea-' + project, session_id=project, is_new=True,
                        title='Same title', relevant_excerpt='Context for ' + project, tools=[],
                    ))
                    self.assertEqual((await queue.process_one(job.job_id)).status, 'completed')
                self.assertEqual(len(await store.get_all_ideas()), 2)
                self.assertEqual((await store.get_idea('idea-a')).raw_body, 'Context for a')
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                    self.assertEqual([idea['id'] for idea in (await client.get('/ideas?session_id=b')).json()], ['idea-b'])
                    self.assertEqual((await client.get('/ideas?session_id=new')).json(), [])
                    response = await client.post('/ideas/idea-a/text-edits', json={
                        'session_id': 'b', 'edit_id': 'wrong-project', 'title': 'Bad edit',
                    })
                    self.assertEqual(response.status_code, 409)
                mismatch = await queue.enqueue('late', 'Wrong project', RoutedIdeaMatch(
                    idea_id='idea-a', session_id='b', relevant_excerpt='Wrong project', tools=[],
                ))
                self.assertEqual((await queue.process_one(mismatch.job_id)).status, 'failed')
                self.assertEqual((await store.get_idea('idea-a')).raw_body, 'Context for a')
