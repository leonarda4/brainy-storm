import json
import os
import re
import asyncio
import time
import httpx
from typing import Dict, Any, Optional, List
from .config import (
    DEFAULT_PROVIDER,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    GEMINI_MODEL,
    GROUNDED_SEARCH_TIMEOUT_SECONDS,
    OPENAI_MODEL,
    LLM_TIMEOUT_SECONDS,
)


class LLMClient:
    """Unified async client supporting Gemini (with Search Grounding), OpenAI, and Smart Mock mode."""

    def __init__(self):
        self.gemini_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
        self.openai_key = OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "")
        self.http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(LLM_TIMEOUT_SECONDS, connect=10.0)
        )

    async def close(self):
        await self.http_client.aclose()

    async def search_web(self, query: str, num_results: int = 5) -> List[Dict[str, str]]:
        """Performs a live web search using DuckDuckGo API or HTML fallback."""
        results = []
        try:
            # DuckDuckGo Instant Answer API
            resp = await self.http_client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("AbstractText"):
                    results.append({
                        "title": data.get("Heading", query),
                        "snippet": data.get("AbstractText", ""),
                        "url": data.get("AbstractURL", "")
                    })
                for topic in data.get("RelatedTopics", [])[:num_results]:
                    if isinstance(topic, dict) and "Text" in topic:
                        results.append({
                            "title": topic.get("Text", "")[:60],
                            "snippet": topic.get("Text", ""),
                            "url": topic.get("FirstURL", "")
                        })
        except Exception:
            pass

        # If empty, try lite search
        if not results:
            try:
                lite_resp = await self.http_client.post(
                    "https://lite.duckduckgo.com/lite/",
                    data={"q": query},
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=15.0,
                )
                if lite_resp.status_code == 200:
                    text = lite_resp.text
                    snippets = re.findall(r'<td class="result-snippet">([^<]+)</td>', text)
                    for s in snippets[:num_results]:
                        clean = s.strip()
                        if clean:
                            results.append({"title": query, "snippet": clean, "url": ""})
            except Exception:
                pass

        return results

    async def generate_json(
        self,
        prompt: str,
        system_instruction: str = "",
        enable_search: bool = False,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate JSON without disguising configured-provider failures as success."""
        provider = DEFAULT_PROVIDER.lower().strip()
        if provider == "mock":
            return self._generate_smart_mock(prompt, system_instruction)

        if provider == "gemini":
            if not self.gemini_key:
                raise RuntimeError("DEFAULT_PROVIDER=gemini but GEMINI_API_KEY is not configured.")
            return await self._call_gemini(
                prompt, system_instruction, enable_search=enable_search, model=model
            )

        if provider == "openai":
            if not self.openai_key:
                raise RuntimeError("DEFAULT_PROVIDER=openai but OPENAI_API_KEY is not configured.")
            return await self._call_openai(prompt, system_instruction)

        if provider != "auto":
            raise RuntimeError("DEFAULT_PROVIDER must be one of: auto, gemini, openai, mock.")

        configured_provider_failed = False
        if self.gemini_key:
            try:
                return await self._call_gemini(
                    prompt, system_instruction, enable_search=enable_search, model=model
                )
            except Exception as e:
                configured_provider_failed = True
                print(f"[LLMClient] Gemini error: {type(e).__name__}. Attempting OpenAI fallback...")

        if self.openai_key:
            try:
                return await self._call_openai(prompt, system_instruction)
            except Exception as e:
                configured_provider_failed = True
                print(f"[LLMClient] OpenAI error: {type(e).__name__}.")

        if configured_provider_failed:
            raise RuntimeError(
                "All configured LLM providers failed. Run `python -m "
                "backend.enrichment.ping_models --provider <provider>` for details."
            )

        # No keys is an intentional local-development fallback.
        return self._generate_smart_mock(prompt, system_instruction)

    async def ping_models(self, provider: str = "all") -> Dict[str, Any]:
        """Make a minimal real request to configured providers.

        Unlike generation, this never falls back to mock mode, so it is safe to
        use as a credentials/model/connectivity diagnostic.
        """
        selected = provider.lower().strip()
        if selected not in {"all", "gemini", "openai"}:
            raise ValueError("provider must be one of: all, gemini, openai")

        providers = ["gemini", "openai"] if selected == "all" else [selected]
        checks = await asyncio.gather(*(self._ping_provider(name) for name in providers))
        return {
            "ok": all(check["status"] == "ok" for check in checks),
            "providers": {check["provider"]: check for check in checks},
        }

    async def _ping_provider(self, provider: str) -> Dict[str, Any]:
        model = GEMINI_MODEL if provider == "gemini" else OPENAI_MODEL
        key = self.gemini_key if provider == "gemini" else self.openai_key
        base = {"provider": provider, "model": model}
        if not key:
            return {**base, "status": "not_configured", "latency_ms": None}

        started = time.perf_counter()
        try:
            if provider == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                response = await self.http_client.post(
                    url,
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": "Return JSON with a single boolean field named pong set to true."}]}],
                        "generationConfig": {
                            "responseMimeType": "application/json",
                            "maxOutputTokens": 32,
                            "temperature": 0,
                        },
                    },
                )
            else:
                response = await self.http_client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Reply with exactly PONG"}],
                        "max_tokens": 8,
                        "temperature": 0,
                    },
                )
            response.raise_for_status()
            return {
                **base,
                "status": "ok",
                "latency_ms": round((time.perf_counter() - started) * 1000),
            }
        except httpx.HTTPStatusError as exc:
            return {
                **base,
                "status": "error",
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "http_status": exc.response.status_code,
                "error": "Provider rejected the ping request.",
            }
        except Exception as exc:
            return {
                **base,
                "status": "error",
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "error": f"{type(exc).__name__}: network request failed.",
            }

    async def _call_gemini(
        self,
        prompt: str,
        system_instruction: str,
        enable_search: bool = False,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        selected_model = model or GEMINI_MODEL
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent"
        
        body: Dict[str, Any] = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }

        if system_instruction:
            body["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        # If search grounding is requested and model supports tools
        if enable_search:
            body["tools"] = [{"googleSearch": {}}]

        try:
            resp = await self.http_client.post(
                url,
                headers={"x-goog-api-key": self.gemini_key, "Content-Type": "application/json"},
                json=body,
                timeout=httpx.Timeout(
                    min(GROUNDED_SEARCH_TIMEOUT_SECONDS, LLM_TIMEOUT_SECONDS)
                    if enable_search
                    else LLM_TIMEOUT_SECONDS,
                    connect=10.0,
                ),
            )
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                "Gemini grounded-search request timed out."
                if enable_search
                else f"Gemini request timed out after {LLM_TIMEOUT_SECONDS:g}s."
            ) from exc
        except httpx.RequestError as exc:
            raise RuntimeError(
                f"Gemini network request failed: {type(exc).__name__}."
            ) from exc
        if resp.is_error:
            try:
                provider_message = str(resp.json().get("error", {}).get("message", ""))
            except Exception:
                provider_message = ""
            detail = provider_message[:500] or "Provider rejected the request."
            raise RuntimeError(f"Gemini request failed ({resp.status_code}): {detail}")
        data = resp.json()
        
        # Extract text from response
        candidates = data.get("candidates", [])
        if not candidates:
            raise ValueError("No candidates returned by Gemini")
            
        candidate = candidates[0]
        parts = candidate.get("content", {}).get("parts", [])
        text_content = "".join(
            str(part.get("text", "")) for part in parts if isinstance(part, dict)
        ) or "{}"
        cleaned_content = text_content.strip()
        if cleaned_content.startswith("```"):
            cleaned_content = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned_content)
        parsed = json.loads(cleaned_content)

        # Preserve the provider-returned grounding URLs for the competitor API.
        grounding_chunks = candidate.get("groundingMetadata", {}).get("groundingChunks", [])
        grounded_urls = []
        for chunk in grounding_chunks:
            web = chunk.get("web", {}) if isinstance(chunk, dict) else {}
            uri = web.get("uri")
            if uri:
                grounded_urls.append(str(uri))
        if grounded_urls and isinstance(parsed, dict):
            existing_sources = parsed.get("groundingSources")
            if not isinstance(existing_sources, list):
                existing_sources = []
            parsed["groundingSources"] = list(dict.fromkeys(
                existing_sources + grounded_urls
            ))
        return parsed

    async def _call_openai(self, prompt: str, system_instruction: str) -> Dict[str, Any]:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.openai_key}",
            "Content-Type": "application/json"
        }
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction + "\nReturn ONLY valid JSON."})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": OPENAI_MODEL,
            "messages": messages,
            "response_format": {"type": "json_object"}
        }

        resp = await self.http_client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)

    def _generate_smart_mock(self, prompt: str, system_instruction: str = "") -> Dict[str, Any]:
        """Provides realistic mock data when offline or keys are not provided."""
        lower_sys = system_instruction.lower()
        first_line = prompt.strip().split("\n")[0].lower()

        # 0. Idea transcript relevance extraction
        if "idea transcript relevance extractor" in lower_sys:
            match = re.search(
                r"NEW TRANSCRIPT DELTA START\s*(.*?)\s*NEW TRANSCRIPT DELTA END",
                prompt,
                flags=re.DOTALL,
            )
            relevant_body = match.group(1).strip() if match else ""
            return {
                "is_relevant": bool(relevant_body),
                "relevant_body": relevant_body,
                "reason": "Offline mock mode keeps the supplied delta as relevant context.",
            }

        # 0b. System architecture agent
        if "system architecture diagram agent" in lower_sys:
            return {
                "summary": "An API accepts classified transcript chunks, queues per-idea work, and persists versioned enrichment artifacts.",
                "nodes": [
                    {"id": "client", "label": "Transcript Client", "description": "Sends classified chunks", "component_type": "client"},
                    {"id": "api", "label": "Enrichment API", "description": "Validates and enqueues work", "component_type": "api"},
                    {"id": "queue", "label": "Per-Idea Queue", "description": "Serializes each idea", "component_type": "queue"},
                    {"id": "agents", "label": "Enrichment Agents", "description": "Generate analysis and diagrams", "component_type": "model"},
                    {"id": "store", "label": "Idea Artifact Store", "description": "Persists JSON, Markdown, Mermaid, and SVG", "component_type": "database"},
                ],
                "edges": [
                    {"source": "client", "target": "api", "label": "classified chunk"},
                    {"source": "api", "target": "queue", "label": "job"},
                    {"source": "queue", "target": "agents", "label": "ordered execution"},
                    {"source": "agents", "target": "store", "label": "versioned artifacts"},
                ],
                "mermaid_code": "flowchart LR\n  A[Transcript Client] --> B[Enrichment API]\n  B --> C[Per-Idea Queue]\n  C --> D[Enrichment Agents]\n  D --> E[Idea Artifact Store]",
                "image_prompt": "Clean system architecture diagram with API, queue, AI agents, and artifact storage",
            }

        # 1. Competitor Agent
        if "competitive landscapes" in lower_sys or "competitor research ai agent" in first_line:
            return {
                "summary": "Offline demonstration competitor analysis; configure a provider for live research.",
                "competitors": [
                    {
                        "name": "Demo competitor (offline)",
                        "summary": "Placeholder result produced without a configured live model.",
                        "differentiator": "Not suitable for market conclusions.",
                        "idea": "Demonstration only",
                        "yearOfFounding": "Unknown",
                        "shortBio": "Offline placeholder—not a researched company profile.",
                        "howWeDiffer": "Run with a valid provider to calculate this."
                    },
                ],
                "market_landscape": "Unavailable in offline mock mode.",
                "our_positioning": "Unavailable in offline mock mode.",
                "groundingSources": [],
            }

        # 2. Workflow Agent
        if "senior software architect" in lower_sys or "visual workflow ai agent" in first_line:
            return {
                "summary": "Continuous voice capture feeds an idea extraction pipeline that triggers asynchronous agentic enrichment.",
                "steps": [
                    "User speaks in brainstorming session",
                    "Speech stream is transcribed in real-time",
                    "Engine detects and categorizes distinct ideas",
                    "Agentic router dispatches asynchronous tool calls (Competitors, Workflow, Pros/Cons)",
                    "Data is atomically persisted and live UI updates via WebSocket"
                ],
                "mermaid_code": "graph TD\n    A[Audio Input] --> B[Transcriber Microservice]\n    B --> C[Idea Engine]\n    C --> D{Agentic Router}\n    D -->|Web Research| E[Competitor Agent]\n    D -->|Process Mapping| F[Workflow Agent]\n    D -->|Debate Extraction| G[Pros & Cons Agent]\n    E --> H[Atomic ideas.json]\n    F --> H\n    G --> H\n    H --> I[Frontend Live Board]",
                "image_prompt": "Futuristic modern interactive brainstorming dashboard with floating agent cards, glowing data streams, sleek tech aesthetic"
            }

        # 3. Pros / Cons Agent
        if "product evaluator" in lower_sys or "critical debate" in first_line:
            return {
                "summary": "The discussion favors faster synthesis and alignment while highlighting reliability, cost, and privacy risks.",
                "pros": [
                    {"point": "Eliminates manual note-taking and idea synthesis during fast-paced brainstorming", "category": "Operations", "severity_or_impact": "High", "source_context": "Supporters emphasized faster synthesis."},
                    {"point": "Real-time competitor grounding prevents teams from reinventing the wheel", "category": "Business & Market", "severity_or_impact": "High", "source_context": "The team requested competitor validation."},
                    {"point": "Instant visual workflows accelerate shared team alignment", "category": "User Experience", "severity_or_impact": "Medium", "source_context": "Participants asked for workflow visuals."}
                ],
                "cons": [
                    {"point": "Requires reliable low-latency speech transcription", "category": "Technical", "severity_or_impact": "High", "source_context": "Transcription quality is a dependency."},
                    {"point": "Agentic tool calls can accumulate LLM token costs if not throttled", "category": "Operations", "severity_or_impact": "High", "source_context": "The design calls multiple agents."},
                    {"point": "Competitor claims can hallucinate without search verification", "category": "Compliance & Security", "severity_or_impact": "Medium", "source_context": "Research must remain grounded."}
                ],
                "key_risks": [
                    "Microservice synchronization lag between transcriber and engine",
                    "Noise or cross-talk in room audio degrading idea extraction"
                ],
                "open_questions": [
                    "How often should the router re-evaluate updated idea context?",
                    "Should user manual clicks interrupt or queue behind background auto-evaluations?"
                ],
                "assumptions": ["Transcript chunks include stable IDs and speaker attribution"],
                "proponents": [
                    "Voice-first interface enables zero-friction ideation",
                    "Automatic agentic competitor check provides immediate reality testing"
                ],
                "opponents": [
                    "Concerned that spontaneous ideas might be prematurely rejected by competitor analysis",
                    "Need to verify privacy of recorded brainstorming sessions"
                ]
            }

        # 4. Decision / Triage Router
        if "agent dispatcher" in lower_sys or "agentic triage router" in first_line:
            return {
                "call_competitors": True,
                "competitor_reason": "Context discusses market alternatives and product category.",
                "call_workflow": True,
                "workflow_reason": "Context outlines key architecture and operational flow.",
                "call_pros_cons": True,
                "pros_cons_reason": "Context contains trade-off arguments and team feedback.",
                "summary_refinement": None,
                "new_proponents": ["Identified strong user demand in the discussion"],
                "new_opponents": ["Concerns raised regarding scalability and API rate limits"]
            }

        return {"status": "ok", "message": "Processed successfully"}


llm_client = LLMClient()
