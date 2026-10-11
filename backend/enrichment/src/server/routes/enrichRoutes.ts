/**
 * REST API Routes for Idea Enrichment and Frontend Integration
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchCompetitors } from '../agents/competitorAgent.js';
import { extractAndSortProsCons } from '../agents/prosConsAgent.js';
import { generateIdeaSummary } from '../agents/summaryAgent.js';
import { generateDiagram } from '../agents/workflowAgent.js';
import { generateSystemGraph } from '../agents/systemGraphAgent.js';
import type { IdeaModel } from '../schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getIdeasFilePath(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../data/ideas.json'),
    path.resolve(process.cwd(), 'data/ideas.json'),
    path.resolve(__dirname, '../../../../data/ideas.json'),
    path.resolve(__dirname, '../../../data/ideas.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function readIdeasData(): { ideas: Array<Record<string, unknown>> } {
  const filePath = getIdeasFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Storage] Failed to read ideas.json:', err);
  }
  return { ideas: [] };
}

function writeIdeasData(data: { ideas: Array<Record<string, unknown>> }): void {
  const filePath = getIdeasFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Storage] Failed to write ideas.json:', err);
  }
}

export const enrichRouter = Router();

// Helper to extract and normalize idea parameters from request body
function parseIdeaRequest(body: unknown): {
  id: string;
  title: string;
  summary: string;
  fullBody: string;
  proponents: string[];
  opponents: string[];
  idea?: IdeaModel;
} {
  const b = (body || {}) as {
    idea?: IdeaModel;
    id?: string;
    title?: string;
    summary?: string;
    fullBody?: string;
    rawContext?: string;
    body?: string;
    proponents?: string[];
    opponents?: string[];
  };

  const idea = b.idea;
  const id = idea?.id || b.id || `idea_${Date.now()}`;
  const title = idea?.title || b.title || 'Untitled Idea';
  const summary = idea?.summary || b.summary || '';
  const fullBody = idea?.fullBody || b.fullBody || b.body || ((idea as unknown as Record<string, unknown>)?.rawContext as string) || b.rawContext || '';
  const proponents = Array.isArray(idea?.proponents) ? idea.proponents : Array.isArray(b.proponents) ? b.proponents : [];
  const opponents = Array.isArray(idea?.opponents) ? idea.opponents : Array.isArray(b.opponents) ? b.opponents : [];

  return { id, title, summary, fullBody, proponents, opponents, idea };
}

/**
 * Health Check & API Status
 */
enrichRouter.get('/health', (_req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5);
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    engine: 'gemini-3.8-flash',
    geminiKeyConfigured: hasKey,
    endpoints: [
      'POST /api/idea/summary (Distills fullBody into executive summary)',
      'POST /api/idea/pros-cons (Identifies & sorts team pros and cons from fullBody)',
      'POST /api/idea/diagram (Generates nodes & SVG diagram from fullBody)',
      'POST /api/idea/architecture-graph (Generates 2D node-and-connector network graph)',
      'POST /api/idea/competitors (Google Search: name, idea, yearOfFounding, bio, howWeDiffer)',
      'POST /api/idea/enrich-all (Multi-agent orchestrator)',
      'POST /api/idea/update-body (Continuous body updates from frontend)',
    ],
  });
});

/**
 * 1. Summary Endpoint: Generate / Update Summary based on title and fullBody
 */
enrichRouter.post('/idea/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!title && !fullBody) {
      res.status(400).json({ error: 'Title or fullBody discussion content is required.' });
      return;
    }

    const { summary, keyTakeaway } = await generateIdeaSummary(title, fullBody);

    const updatedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        fullBody,
        proponents,
        opponents,
        createdAt: Date.now(),
      }),
      summary,
      updatedAt: Date.now(),
    };

    res.json({
      success: true,
      summary,
      keyTakeaway,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/summary] Error:', message);
    res.status(500).json({ error: 'Failed to generate summary', details: message });
  }
});

/**
 * 2. Pros and Cons Endpoint: Identifies and sorts team pros and cons from fullBody
 */
enrichRouter.post('/idea/pros-cons', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, summary, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!fullBody && !summary) {
      res.status(400).json({ error: 'fullBody discussion content is required to extract pros and cons.' });
      return;
    }

    const prosAndCons = await extractAndSortProsCons(title, summary, fullBody, proponents, opponents);

    const updatedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        summary,
        fullBody,
        proponents,
        opponents,
        createdAt: Date.now(),
      }),
      prosAndCons,
      updatedAt: Date.now(),
    };

    res.json({
      success: true,
      prosAndCons,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/pros-cons] Error:', message);
    res.status(500).json({ error: 'Failed to extract pros and cons', details: message });
  }
});

/**
 * 3. Diagram Creation Endpoint: Generates workflow/architecture diagram from fullBody
 */
enrichRouter.post('/idea/diagram', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, summary, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!title && !fullBody) {
      res.status(400).json({ error: 'Title and fullBody are required to generate a diagram.' });
      return;
    }

    const diagram = await generateDiagram(title, summary, fullBody);

    const updatedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        summary,
        fullBody,
        proponents,
        opponents,
        createdAt: Date.now(),
      }),
      diagram,
      updatedAt: Date.now(),
    };

    res.json({
      success: true,
      diagram,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/diagram] Error:', message);
    res.status(500).json({ error: 'Failed to generate diagram', details: message });
  }
});

/**
 * 3b. Architecture & System Graph Endpoint (Whiteboard style network graph)
 */
enrichRouter.post(['/idea/architecture-graph', '/idea/system-graph'], async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, summary, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!title && !fullBody) {
      res.status(400).json({ error: 'Title and fullBody are required to generate architecture graph.' });
      return;
    }

    const systemGraph = await generateSystemGraph(title, summary, fullBody);

    const updatedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        summary,
        fullBody,
        proponents,
        opponents,
        createdAt: Date.now(),
      }),
      systemGraph,
      updatedAt: Date.now(),
    };

    res.json({
      success: true,
      systemGraph,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/architecture-graph] Error:', message);
    res.status(500).json({ error: 'Failed to generate architecture graph', details: message });
  }
});

/**
 * 4. Competitors Endpoint: Google Search grounded query
 * Returns: name, idea, yearOfFounding, shortBio, howWeDiffer
 */
enrichRouter.post('/idea/competitors', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, summary, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!title && !summary && !fullBody) {
      res.status(400).json({ error: 'Title or description required for competitor search.' });
      return;
    }

    const competitors = await searchCompetitors(title, summary, fullBody);

    const updatedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        summary,
        fullBody,
        proponents,
        opponents,
        createdAt: Date.now(),
      }),
      competitors,
      updatedAt: Date.now(),
    };

    res.json({
      success: true,
      competitors,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/competitors] Error:', message);
    res.status(500).json({ error: 'Failed to search competitors', details: message });
  }
});

/**
 * 5. Full Enrichment Orchestrator: Runs summary, pros/cons, diagram, and competitor search
 */
enrichRouter.post('/idea/enrich-all', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, summary: initialSummary, fullBody, proponents, opponents, idea } = parseIdeaRequest(req.body);

    if (!title && !fullBody) {
      res.status(400).json({ error: 'Title and fullBody are required for full enrichment.' });
      return;
    }

    // Step 1: Ensure we have a crisp summary if not already provided or if body updated
    let activeSummary = initialSummary;
    let keyTakeaway = '';
    try {
      const summaryResult = await generateIdeaSummary(title, fullBody);
      activeSummary = summaryResult.summary;
      keyTakeaway = summaryResult.keyTakeaway;
    } catch (e) {
      console.warn('Summary generation step warning:', e);
    }

    // Step 2: Concurrently execute Pros/Cons, Diagram, Architecture Graph, and Competitor search
    const [prosConsResult, diagramResult, systemGraphResult, competitorResult] = await Promise.allSettled([
      extractAndSortProsCons(title, activeSummary, fullBody, proponents, opponents),
      generateDiagram(title, activeSummary, fullBody),
      generateSystemGraph(title, activeSummary, fullBody),
      searchCompetitors(title, activeSummary, fullBody),
    ]);

    const enrichedIdea: IdeaModel = {
      ...(idea || {
        id,
        title,
        createdAt: Date.now(),
      }),
      summary: activeSummary,
      fullBody,
      proponents,
      opponents,
      updatedAt: Date.now(),
    };

    const executionLog: Record<string, { status: string; error?: string }> = {
      summary: { status: 'success' },
    };

    if (prosConsResult.status === 'fulfilled') {
      enrichedIdea.prosAndCons = prosConsResult.value;
      executionLog.prosAndCons = { status: 'success' };
    } else {
      executionLog.prosCons = { status: 'failed', error: prosConsResult.reason?.message };
    }

    if (diagramResult.status === 'fulfilled') {
      enrichedIdea.diagram = diagramResult.value;
      executionLog.diagram = { status: 'success' };
    } else {
      executionLog.diagram = { status: 'failed', error: diagramResult.reason?.message };
    }

    if (systemGraphResult.status === 'fulfilled') {
      enrichedIdea.systemGraph = systemGraphResult.value;
      executionLog.systemGraph = { status: 'success' };
    } else {
      executionLog.systemGraph = { status: 'failed', error: systemGraphResult.reason?.message };
    }

    if (competitorResult.status === 'fulfilled') {
      enrichedIdea.competitors = competitorResult.value;
      executionLog.competitors = { status: 'success' };
    } else {
      executionLog.competitors = { status: 'failed', error: competitorResult.reason?.message };
    }

    // Sync enriched idea to persistent data/ideas.json
    try {
      const data = readIdeasData();
      const existingIdx = data.ideas.findIndex((i) => i.id === enrichedIdea.id || i.title === enrichedIdea.title);
      const storageRecord = {
        id: enrichedIdea.id,
        title: enrichedIdea.title,
        summary: enrichedIdea.summary,
        proponents: enrichedIdea.proponents,
        opponents: enrichedIdea.opponents,
        competitors: enrichedIdea.competitors,
        workflow: enrichedIdea.diagram
          ? {
              summary: enrichedIdea.diagram.summary,
              steps: enrichedIdea.diagram.nodes.map((n) => n.title),
              mermaid_code: enrichedIdea.diagram.mermaidCode,
            }
          : null,
        systemGraph: enrichedIdea.systemGraph,
        pros_cons: enrichedIdea.prosAndCons
          ? {
              summary: enrichedIdea.prosAndCons.summary,
              pros: enrichedIdea.prosAndCons.pros.map((p) => p.point),
              cons: enrichedIdea.prosAndCons.cons.map((c) => c.point),
            }
          : null,
        status: 'enriched',
        updated_at: Date.now() / 1000,
      };

      if (existingIdx >= 0) {
        data.ideas[existingIdx] = { ...data.ideas[existingIdx], ...storageRecord };
      } else {
        data.ideas.push({ ...storageRecord, created_at: Date.now() / 1000 });
      }
      writeIdeasData(data);
    } catch (saveErr) {
      console.warn('[Route /idea/enrich-all] Storage sync warning:', saveErr);
    }

    res.json({
      success: true,
      keyTakeaway,
      enrichedIdea,
      executionLog,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/enrich-all] Error:', message);
    res.status(500).json({ error: 'Failed full enrichment pipeline', details: message });
  }
});

/**
 * 6. Update Body Endpoint: Continuous updates as new conversation/text arrives from frontend
 */
enrichRouter.post('/idea/update-body', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idea, appendText, newFullBody, proponents, opponents, autoEnrich } = req.body as {
      idea: IdeaModel;
      appendText?: string;
      newFullBody?: string;
      proponents?: string[];
      opponents?: string[];
      autoEnrich?: boolean;
    };

    if (!idea) {
      res.status(400).json({ error: 'Existing idea object is required.' });
      return;
    }

    const updatedFullBody = newFullBody
      ? newFullBody
      : appendText
        ? `${idea.fullBody || ''}\n\n${appendText}`.trim()
        : idea.fullBody || '';

    const updatedProponents = proponents || idea.proponents || [];
    const updatedOpponents = opponents || idea.opponents || [];

    const updatedIdea: IdeaModel = {
      ...idea,
      fullBody: updatedFullBody,
      proponents: updatedProponents,
      opponents: updatedOpponents,
      updatedAt: Date.now(),
    };

    if (autoEnrich) {
      // Re-run pros and cons on the updated body
      const prosAndCons = await extractAndSortProsCons(
        updatedIdea.title,
        updatedIdea.summary,
        updatedFullBody,
        updatedProponents,
        updatedOpponents
      );
      updatedIdea.prosAndCons = prosAndCons;
    }

    // Persist to ideas.json
    try {
      const data = readIdeasData();
      const existingIdx = data.ideas.findIndex((i) => i.id === updatedIdea.id || i.title === updatedIdea.title);
      if (existingIdx >= 0) {
        data.ideas[existingIdx] = {
          ...data.ideas[existingIdx],
          summary: updatedIdea.summary,
          proponents: updatedIdea.proponents,
          opponents: updatedIdea.opponents,
          updated_at: Date.now() / 1000,
        };
        writeIdeasData(data);
      }
    } catch (saveErr) {
      console.warn('[Route /idea/update-body] Storage sync warning:', saveErr);
    }

    res.json({
      success: true,
      updatedIdea,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Route /idea/update-body] Error:', message);
    res.status(500).json({ error: 'Failed to update idea body', details: message });
  }
});

/**
 * 7. Ideas Collection Endpoints for shared microservice interoperability
 */
enrichRouter.get('/ideas', (_req: Request, res: Response) => {
  const data = readIdeasData();
  res.json(data);
});

enrichRouter.get('/ideas/:id', (req: Request, res: Response): void => {
  const data = readIdeasData();
  const id = req.params.id;
  const found = data.ideas.find((i) => i.id === id || i.title === id);
  if (!found) {
    res.status(404).json({ error: 'Idea not found' });
    return;
  }
  res.json({ idea: found });
});

enrichRouter.post('/ideas', (req: Request, res: Response) => {
  const data = readIdeasData();
  const b = (req.body || {}) as Record<string, unknown>;
  const id = (b.id as string) || `idea_${Date.now()}`;
  const existingIdx = data.ideas.findIndex((i) => i.id === id);

  const ideaRecord = {
    id,
    title: b.title || 'Untitled Idea',
    summary: b.summary || '',
    proponents: b.proponents || [],
    opponents: b.opponents || [],
    status: b.status || 'idle',
    updated_at: Date.now() / 1000,
    ...b,
  };

  if (existingIdx >= 0) {
    data.ideas[existingIdx] = { ...data.ideas[existingIdx], ...ideaRecord };
  } else {
    data.ideas.push({ ...ideaRecord, created_at: Date.now() / 1000 });
  }

  writeIdeasData(data);
  res.json({ success: true, idea: ideaRecord });
});

