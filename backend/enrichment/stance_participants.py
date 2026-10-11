"""Keep empty or descriptive stance labels out of participant lists."""

import re
import unicodedata


_NO_PERSON = re.compile(
    r"\b(?:none|nobody|no one|unknown|unidentified|anonymous|unattributed|"
    r"proponents?|supporters?|opponents?|opposition|support|objections?|"
    r"consensus|critics?|skeptics?|team|everyone|participants?|users?|group|room)\b",
    re.IGNORECASE,
)
_STANCE_VERB = re.compile(
    r"\s+(?:who|advocates?|argues?|argued|backs?|believes?|champions?|"
    r"challenges?|challenged|contends?|criticizes?|emphasizes?|expressed|"
    r"highlights?|opposes?|prefers?|promotes?|proposes?|proposed|questions?|"
    r"recommends?|reintroduced|rejects?|suggests?|supports?|supported|warns?|cautions?)\b",
    re.IGNORECASE,
)


def clean_participant_attributions(values) -> list[str]:
    if not isinstance(values, list):
        return []
    people = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = " ".join(unicodedata.normalize("NFKC", value).split())
        # Legacy entries may include a real person's role or attributed argument.
        # Match only the identity, so "Alex (opposes the consensus)" remains valid.
        identity = re.split(r"[:(,]", text, maxsplit=1)[0].strip()
        identity = _STANCE_VERB.split(identity, maxsplit=1)[0]
        if not identity or _NO_PERSON.search(identity):
            continue
        if text not in people:
            people.append(text)
    return people
