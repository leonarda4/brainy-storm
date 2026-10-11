import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from main import IdeaUpdate, TranscriptProcessor, load_known_ideas


class ProjectTests(unittest.TestCase):
    def test_identical_ideas_stay_in_their_project_and_restart_does_not_replay(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            ideas = root / 'ideas.json'
            ideas.write_text(json.dumps({'ideas': [
                {'id': 'a-existing', 'title': 'Existing A', 'session_id': 'a'},
                {'id': 'b-existing', 'title': 'Existing B', 'session_id': 'b'},
            ]}))
            topic, classified = root / 'updates.jsonl', root / 'classified.jsonl'
            for project in ('a', 'b'):
                path = root / project / 'transcript.txt'
                path.parent.mkdir()
                path.write_text(f'[Maya] Context for {project}.\n')
                processor = TranscriptProcessor(path, ideas, project)

                def extract(known, chunk):
                    self.assertEqual(set(known), {f'{project}-existing'})
                    self.assertIn(f'Context for {project}', chunk)
                    return [IdeaUpdate(id=None, title='Same title', summary=project)]

                processor.tick(extract, topic, classified, len(path.read_text()))
                before = classified.read_text()
                resumed = TranscriptProcessor(path, ideas, project)
                resumed.tick(lambda *_: self.fail('replayed saved text'), topic, classified, 1)
                self.assertEqual(classified.read_text(), before)
            records = [json.loads(line) for line in classified.read_text().splitlines() if json.loads(line)['ideas']]
            self.assertEqual([item['session_id'] for item in records], ['a', 'b'])
            self.assertNotEqual(records[0]['ideas'][0]['id'], records[1]['ideas'][0]['id'])
            self.assertEqual(set(load_known_ideas(ideas, 'a')), {'a-existing'})

    def test_reset_while_classifier_is_running_discards_old_response(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'transcript.txt'
            path.write_text('Old context.\n')
            processor = TranscriptProcessor(path, root / 'ideas.json', 'a')
            def extract(*_):
                replacement = root / 'replacement.txt'
                replacement.write_text('')
                replacement.replace(path)
                return [IdeaUpdate(id=None, title='Stale idea', summary='')]
            topic = root / 'classified.jsonl'
            processor.tick(extract, root / 'updates.jsonl', topic, 1)
            self.assertFalse(topic.exists())
