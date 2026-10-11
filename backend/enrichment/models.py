from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
import uuid
import time
from .stance_participants import clean_participant_attributions


class CompetitorItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str = "Unknown"
    summary: str = ""
    differentiator: str = ""  # How they differ or what their unique angle is
    idea: Optional[str] = None
    yearOfFounding: Optional[str] = None
    shortBio: Optional[str] = None
    howWeDiffer: Optional[str] = None


class CompetitorEnrichment(BaseModel):
    model_config = ConfigDict(extra="allow")
    summary: Optional[str] = None
    competitors: List[CompetitorItem] = Field(default_factory=list)
    market_landscape: str = ""
    our_positioning: str = ""  # How we position ourselves against them
    groundingSources: Optional[List[str]] = Field(default_factory=list)
    generated_at: float = Field(default_factory=time.time)


class WorkflowEnrichment(BaseModel):
    model_config = ConfigDict(extra="allow")
    summary: str = ""
    steps: List[str] = Field(default_factory=list)
    mermaid_code: Optional[str] = ""  # Mermaid.js diagram (flowchart or sequence)
    mermaidCode: Optional[str] = None
    image_prompt: str = ""  # Ready-to-use prompt for image generation
    image_url: Optional[str] = None  # URL or local path to generated thumbnail/diagram
    generated_at: float = Field(default_factory=time.time)


class ArchitectureNode(BaseModel):
    id: str
    label: str
    description: str = ""
    component_type: str = "service"


class ArchitectureEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class ArchitectureEnrichment(BaseModel):
    summary: str = ""
    nodes: List[ArchitectureNode] = Field(default_factory=list)
    edges: List[ArchitectureEdge] = Field(default_factory=list)
    mermaid_code: str = ""
    image_prompt: str = ""
    image_url: Optional[str] = None
    generated_at: float = Field(default_factory=time.time)


class ProConItem(BaseModel):
    point: str
    category: str = "General"
    severity_or_impact: Literal["High", "Medium", "Low"] = "Medium"
    source_context: str = ""


class ProsConsEnrichment(BaseModel):
    model_config = ConfigDict(extra="allow")
    summary: Optional[str] = None
    pros: List[ProConItem] = Field(default_factory=list)
    cons: List[ProConItem] = Field(default_factory=list)
    key_risks: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    generated_at: float = Field(default_factory=time.time)

    @field_validator("pros", "cons", mode="before")
    @classmethod
    def upgrade_legacy_string_items(cls, value):
        if not isinstance(value, list):
            return []
        return [
            {"point": item, "category": "General", "severity_or_impact": "Medium"}
            if isinstance(item, str)
            else item
            for item in value
        ]


class TranscriptSegment(BaseModel):
    """One idempotent piece of source transcript assigned to an idea."""

    chunk_id: str
    text: str
    captured_at: float = Field(default_factory=time.time)
    reason: Optional[str] = None


class Idea(BaseModel):
    model_config = ConfigDict(extra="allow", coerce_numbers_to_str=True)
    session_id: str = "Hackathon"
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str
    short_summary: Optional[str] = Field(
        default=None,
        description="One-line upstream screening summary; not used as enrichment context",
    )
    summary: str = ""
    is_currently_discussed: bool = False
    transcript: Optional[str] = None
    raw_body: str = Field(
        default="",
        description="Cumulative transcript excerpts relevant to this idea; canonical enrichment context",
    )
    transcript_segments: List[TranscriptSegment] = Field(default_factory=list)
    content_version: int = Field(default=0, ge=0)
    enriched_version: int = Field(default=0, ge=0)
    proponents: List[str] = Field(
        default_factory=list,
        description="Actual participants explicitly supporting the idea; empty when none"
    )
    opponents: List[str] = Field(
        default_factory=list,
        description="Actual participants explicitly opposing the idea; empty when none"
    )
    thumbnail: Optional[str] = None

    # Agentic Tool Enriched Outputs
    competitors: Optional[CompetitorEnrichment] = None
    workflow: Optional[WorkflowEnrichment] = None
    pros_cons: Optional[ProsConsEnrichment] = None
    systemGraph: Optional[ArchitectureEnrichment] = None

    # Execution State
    status: Literal["idle", "enriching", "enriched", "error"] = "idle"
    active_tools: List[str] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("proponents", "opponents", mode="before")
    @classmethod
    def discard_placeholder_participants(cls, value):
        return clean_participant_attributions(value)

    @model_validator(mode="after")
    def backfill_raw_body_for_legacy_records(self):
        if not self.raw_body and self.transcript:
            self.raw_body = self.transcript
        return self


class ToolDecision(BaseModel):
    """Output from the Decision Router analyzing context delta."""
    call_competitors: bool = False
    competitor_reason: Optional[str] = None
    call_workflow: bool = False
    workflow_reason: Optional[str] = None
    call_pros_cons: bool = False
    pros_cons_reason: Optional[str] = None
    summary_refinement: Optional[str] = None
    new_proponents: List[str] = Field(default_factory=list)
    new_opponents: List[str] = Field(default_factory=list)


# API Request/Response DTOs
class AutoEnrichRequest(BaseModel):
    idea_id: Optional[str] = None
    title: Optional[str] = None
    context: str = Field(..., description="Newly transcribed speech or discussion context")


class ManualEnrichRequest(BaseModel):
    idea_id: Optional[str] = None
    title: Optional[str] = None
    service: Literal["competitors", "workflow", "architecture", "pros_cons", "all"] = Field(
        ...,
        description="Service/tool to run: competitors, workflow, architecture, pros_cons, or all"
    )
    context: Optional[str] = Field(default=None, description="Optional extra context")


class IdeaCreateUpdateRequest(BaseModel):
    id: Optional[str] = None
    title: str
    short_summary: Optional[str] = None
    summary: Optional[str] = None
    transcript: Optional[str] = None
    raw_body: Optional[str] = None
    proponents: List[str] = Field(default_factory=list)
    opponents: List[str] = Field(default_factory=list)
    thumbnail: Optional[str] = None


class TranscriptEnrichRequest(BaseModel):
    """Optional transcript override for one enrichment run.

    When omitted, the selected idea's `transcript` field in ideas.json is used.
    The override is persisted so later refreshes use the same source text.
    """

    transcript: Optional[str] = None


class IdeaIngestRequest(BaseModel):
    title: Optional[str] = None
    transcript: str = Field(
        min_length=1,
        description="New full-session transcript or transcript delta to filter for this idea",
    )
    enrich: bool = True


class IdeaTextEditRequest(BaseModel):
    """Idempotent written contribution to the same context used for speech."""

    edit_id: str = Field(min_length=1, max_length=100)
    session_id: str = "Hackathon"
    title: Optional[str] = Field(default=None, max_length=500)
    summary: Optional[str] = Field(default=None, max_length=20000)
    is_new: bool = False
    idea_title: str = Field(default="Untitled idea", max_length=500)

    @model_validator(mode="after")
    def require_text(self):
        if self.title is None and self.summary is None:
            raise ValueError("An edited title or summary is required.")
        return self


EnrichmentService = Literal[
    "summary", "pros_cons", "workflow", "architecture", "competitors"
]


class RoutedIdeaMatch(BaseModel):
    """Output from the upstream idea-recognition model for one idea."""

    idea_id: str = Field(min_length=1)
    session_id: str = "Hackathon"
    is_new: bool = False
    title: Optional[str] = None
    short_summary: Optional[str] = None
    relevant_excerpt: str = Field(min_length=1)
    reason: Optional[str] = None
    text_edit: Optional[IdeaTextEditRequest] = None
    tools: Optional[List[EnrichmentService]] = Field(
        default=None,
        description=(
            "Optional override. New ideas default to all tools; existing ideas "
            "default to summary and pros_cons."
        ),
    )
    expected_content_version: Optional[int] = Field(default=None, ge=0)


class TranscriptChunkDispatchRequest(BaseModel):
    """Submit one classified transcript chunk and all affected ideas."""

    chunk_id: str = Field(min_length=1)
    transcript: str = Field(min_length=1)
    matches: List[RoutedIdeaMatch] = Field(min_length=1)
    process_now: bool = Field(
        default=False,
        description="When true, wait while the submitted jobs are processed.",
    )


class ClassifiedIdeaReference(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    short_summary: Optional[str] = Field(default=None, alias="short-summary")
    is_currently_discussed: bool = False


class ClassifiedTranscriptChunk(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    session_id: str = "Hackathon"
    chunk: str = Field(min_length=1)
    ideas: List[ClassifiedIdeaReference] = Field(default_factory=list)
    chunk_id: Optional[str] = None
    has_been_processed: bool = Field(default=False, alias="has_been_processsed")


class ClassifiedChunksRequest(BaseModel):
    chunks: List[ClassifiedTranscriptChunk]
    process_now: bool = False


class EnrichmentJob(BaseModel):
    session_id: str = "Hackathon"
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    chunk_id: str
    idea_id: str
    is_new: bool
    title: Optional[str] = None
    short_summary: Optional[str] = None
    relevant_excerpt: str
    source_transcript: str
    reason: Optional[str] = None
    text_edit: Optional[IdeaTextEditRequest] = None
    tools: List[EnrichmentService] = Field(default_factory=list)
    expected_content_version: Optional[int] = None
    status: Literal["queued", "running", "completed", "failed", "skipped"] = "queued"
    created_at: float = Field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
