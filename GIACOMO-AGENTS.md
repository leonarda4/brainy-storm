We work on a real-time brainstorming companion that provides a webapp that listens to a team brainstorming, transcribes, processes and live updates a frontend with new ideas as they pop up.

Services never call each other. They communicate only through files in the root `pubsub/` folder, which is the whole contract between them:

```
[AUDIO] ──► [TRANSCRIBER] ──► pubsub/transcript.txt
                                     │
                                     ▼
            [GEMINI API] ◄──► [ENGINE] ──► pubsub/classified-chunks.jsonl ──► [ENRICHMENT]
                                     │                                            │
                                     ▼                                            ▼
                         pubsub/idea-updates.jsonl ◄──────────────────────────────┘
                                     │
                                     ▼
                                [FRONTEND]
```

| Topic | Publishers | Subscribers |
| --- | --- | --- |
| `transcript.txt` | transcriber | engine |
| `classified-chunks.jsonl` | engine | enrichment |
| `idea-updates.jsonl` | engine, enrichment | frontend |

Live topic files are gitignored; `pubsub/*.example.*` shows their shape.

## Engine

Our focus is the engine: a minimal `while True` Python loop in `backend/engine/main.py`. No overengineering, just a minimal working prototype.

- Polls `pubsub/transcript.txt` and cuts the new text into chunks of about `CHUNK_CHARS` characters.
- Sends each chunk plus the known ideas to Gemini (structured output), which returns new and updated ideas.
- Keeps known ideas in memory only; it never reads back its own topics.
- Per chunk, publishes to `idea-updates.jsonl` first, then to `classified-chunks.jsonl`, so the frontend knows an idea before enrichment does.
- Each run is a fresh session: it truncates both topics at startup, and again when the transcriber clears the transcript.
