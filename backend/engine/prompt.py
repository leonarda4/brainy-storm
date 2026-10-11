import json


def build_prompt(ideas: dict[str, dict], chunk: str) -> str:
    known_ideas = [{"id": idea_id, "title": idea["title"], "summary": idea["summary"]} for idea_id, idea in ideas.items()]
    known_ideas_json = json.dumps(known_ideas, indent=2, ensure_ascii=False)

    return f"""You are the idea tracker of a live brainstorming session. A team is talking, and their speech is transcribed in real time.

You receive:

1. `EXISTING IDEAS`: a JSON list of the ideas captured so far, each with `id`, `title` and `summary`.
2. `NEW TRANSCRIPT CHUNK`: the latest piece of the conversation. It may start or end mid-sentence.

Your task is to find every idea discussed in the chunk and report it.

- If the chunk discusses an existing idea, return it with its `id`. Its `summary` must merge the existing summary with the new information from the chunk: keep what is still valid, add new details, and update anything the team revised. Keep the `title` unless the team clearly renamed or reframed the idea.
- If the chunk introduces a new idea, return it with `id` set to `null`, a short descriptive `title`, and a fresh `summary`.
- Do not return ideas that the chunk does not discuss.
- Do not create a new idea when the chunk only refines, criticizes or extends an existing one.
- Ignore small talk, logistics and filler that contain no idea.
- If the chunk contains no idea at all, return an empty list.

Current discussion focus:
- Set `is_currently_discussed` to true on at most ONE returned idea: the idea being discussed at the END of the chunk, even if it is an existing idea with no new details.
- Set it to false on all other ideas. If the conversation has moved to logistics, small talk, or no identifiable idea, all values must be false.

Writing style:

- `title`: at most 6 words, no trailing punctuation.
- `summary`: 1 to 4 concise sentences describing what the idea is and the key points raised about it. Write in the language of the transcript.
- Only use information present in the existing summaries or the transcript. Never invent details.

EXISTING IDEAS:
{known_ideas_json}

NEW TRANSCRIPT CHUNK:
{chunk}
"""
