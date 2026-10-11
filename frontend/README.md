# brainy stormy frontend

React + TypeScript + Vite. Use Node 22.

```bash
npm ci
npm run dev
```

Open http://localhost:5173. Run the transcriber on port 8010, the Python enrichment API on port 8001, the idea engine, and the classified-chunk worker alongside them (see the root README for the complete live pipeline). `./dev` starts all of these together.

Automatic development reloads and React Fast Refresh are disabled by default so
source edits and generated data cannot tear down an active recording. Ideas and
speaker names still update in place through polling and the recording socket.
Refresh the browser manually after source changes, once recording has stopped;
restart Vite for configuration or environment changes. For UI-only development,
start Vite with `FRONTEND_HMR=true npm run dev`. Runtime files in `data/`, `pubsub/`,
`.runtime/`, and the shared root `.env` files are excluded from its watcher in both
modes. The microphone WebSocket proxy remains enabled.

The browser captures the microphone after **Start recording**. Each person introduces themselves once and speaks for a few seconds. Provisional word fragments stay hidden behind one **Someone is speaking** indicator, or the person's shared avatar and **Name is speaking** when the pending speech includes a known identity. Completed, merged chunks appear after the backend matches the audio and saves them. The current backend identifies speakers at batch completion, so the indicator stays anonymous until an identity is supplied; a previous speaker's name is never assumed for new speech. **Pause** releases the microphone and shows **Finishing transcript…** while waiting for speaker attribution and the final file write. **Resume** continues with the same voice references. **Restart** clears the transcript and voice references while preserving generated ideas. Export downloads the persisted transcript with speaker names. Each speaker uses the shared avatar component, a stable supporting brand color, and one or two initials (first and last name for longer names). Completed unidentified speech displays **Unknown** with **?**. Colors remain consistent when a speaker returns or the page reloads. The panel also reads older `[HH:MM:SS] Name: text` recordings and explicit self-introductions in plain text; neighboring unlabeled passages remain unknown without speaker evidence.

Use only the repository root `.env`. Vite loads public `VITE_*` settings and server proxy targets from it; provider keys stay on the backend and must not have a `VITE_` prefix. The transcriber uses both `GRADIUM_API_KEY` and `GEMINI_API_KEY` from this same file. Restart services after changing it.

Vite proxies `/api/transcriber/*` to `TRANSCRIBER_PORT` (8010 by default) and `/api/enrichment/*` to the Python API on port 8001, stripping the proxy prefix. Override the targets with `TRANSCRIBER_TARGET` and `ENRICHMENT_TARGET`. Docker Compose supplies its own internal targets. Optional direct browser API-base overrides: `VITE_TRANSCRIBER_URL`, `VITE_ENRICHMENT_URL`.

Each storm saves its transcript in `data/storms/<project-id>/transcript.txt`; storm names and the selected storm persist in browser storage. The panel retries a failed initial load automatically, with backoff up to 30 seconds, and clears the load warning when the service recovers. The transcriber can serve an existing file without provider keys; keys are needed when recording. A failed load does not clear the file.

The frontend polls ideas every three seconds, including while an idea page is open. The title, summary, pros and cons, open questions, architecture, workflow, competition research, conclusion, and JSON export receive the latest saved backend results. Requests time out after ten seconds, and failed polls retry with backoff up to thirty seconds.

Title and summary edits are saved locally and, after a short typing pause, posted to `/ideas/{id}/text-edits`. The Python API queues the written contribution alongside speech, appends it to the idea's canonical context, and refreshes all five enrichment stages. Edits remain protected in the browser until polling confirms receipt; live text updates then resume automatically. Retries use the same edit ID to avoid duplicate context. JSON copy/download exports the complete backend record, including written contributions once received.

A storm is a brainstorm session. Each storm has a stable ID, its own transcript, and its own generated and manual ideas. Click the storm heading to rename it; an empty name becomes **New storm**. **New storm** in the sidebar creates an empty storm, and **Start recording** begins capturing audio for the selected storm. Switching storms first finishes saving an active recording. Returning to a storm restores its transcript. Only one microphone recording can run at a time. The storm list stays in this browser; generated ideas retain their session ID in backend storage. The original cleaned conversation lives in **Team discussion**.

Cards have square corners. Horizontal cards scroll independently through the full summary and analysis; grid cards are fixed, non-scrollable summary previews. Click a card's title to open its editable page. Comparison tables and component lists adapt to each card's width; diagram tabs, expandable sections, and JSON controls work directly inside horizontal cards.

Brainy marks the currently discussed idea with a 4px brand-blue border. As classifier updates arrive, the horizontal rail or vertical grid board scrolls just enough to reveal that card. Manual scrolling, dragging, touch and keyboard navigation pause following until five seconds after the last activity; the border keeps tracking the discussion during that pause. Following resumes at the latest idea, respects reduced motion, and stays paused while editing or using menus and dialogs. The delay is `BRAINY_FOCUS_IDLE_MS` in `src/brainyFocus.ts`. Focus comes from the current storm's saved idea flags and survives a transient polling failure. The enrichment API preserves discussion focus separately from enrichment results so late jobs cannot restore an old focus. Restart the enrichment service after updating this backend code.

Open questions, risks and assumptions are generated by the Pros and Cons agent from the discussion and written input. They sit within that analysis section. Process and architecture diagrams have a full-screen viewer with zoom, Fit, and Escape to close. Competitor comparisons use the same table style as pros and cons, stacking their columns in narrow reading areas.

```bash
npm run build
npm run lint
npm test
```
