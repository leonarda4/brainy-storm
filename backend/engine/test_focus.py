import unittest
from main import IdeaUpdate, merge_ideas


class DiscussionFocusTests(unittest.TestCase):
    def test_focus_moves_to_new_idea_and_clears_on_unrelated_chunk(self):
        ideas = [{"id": "existing", "title": "Old", "summary": "", "is_currently_discussed": True}]
        result = merge_ideas(ideas, [IdeaUpdate(id=None, title="New", summary="", is_currently_discussed=True)])
        self.assertEqual([i["id"] for i in result if i["is_currently_discussed"]], [1])
        self.assertFalse(any(i["is_currently_discussed"] for i in merge_ideas(result, [])))

    def test_return_to_existing_idea_and_single_focus(self):
        ideas = [{"id": "old", "title": "Old", "summary": ""}]
        result = merge_ideas(ideas, [
            IdeaUpdate(id=None, title="New", summary="", is_currently_discussed=True),
            IdeaUpdate(id="old", title="Old", summary="More", is_currently_discussed=True),
        ])
        self.assertEqual([i["id"] for i in result if i["is_currently_discussed"]], ["old"])
        self.assertEqual(result[0]["summary"], "More")


if __name__ == '__main__':
    unittest.main()
