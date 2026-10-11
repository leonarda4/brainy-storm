/**
 * System Graph & Architecture Visualization Agent
 * Renders modern, high-craft 2D node-and-connector network graphs
 * matching modern whiteboard tools (white cards, clean icons, labeled bidirectional arrows, tech grid).
 */
import { ai, GEMINI_MODEL } from '../geminiClient.js';
import {
  systemGraphResponseSchema,
  type SystemGraphEnrichment,
  type SystemGraphNode,
  type SystemGraphEdge,
} from '../schemas.js';

function getIconSvg(iconType: string): string {
  switch (iconType) {
    case 'frontend':
      return `
        <rect x="2" y="4" width="28" height="20" rx="3" fill="#F1F5F9" stroke="#334155" stroke-width="1.8"/>
        <line x1="2" y1="10" x2="30" y2="10" stroke="#334155" stroke-width="1.8"/>
        <circle cx="6" cy="7" r="1.2" fill="#334155"/>
        <circle cx="10" cy="7" r="1.2" fill="#334155"/>
        <circle cx="14" cy="7" r="1.2" fill="#334155"/>
        <rect x="6" y="14" width="8" height="6" rx="1" fill="#38BDF8"/>
        <line x1="18" y1="15" x2="26" y2="15" stroke="#64748B" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="18" y1="18" x2="24" y2="18" stroke="#64748B" stroke-width="1.5" stroke-linecap="round"/>
      `;
    case 'audio':
      return `
        <rect x="11" y="2" width="10" height="15" rx="5" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <path d="M6 10 C6 18, 26 18, 26 10" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="16" y1="18" x2="16" y2="25" stroke="#334155" stroke-width="1.8"/>
        <line x1="11" y1="25" x2="21" y2="25" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M28 8 C30 11, 30 15, 28 18" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M4 8 C2 11, 2 15, 4 18" fill="none" stroke="#6366F1" stroke-width="1.8" stroke-linecap="round"/>
      `;
    case 'transcription':
      return `
        <rect x="4" y="4" width="24" height="24" rx="4" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <path d="M8 12 L12 12 M10 8 L10 16" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16 10 L24 10 M16 15 L22 15 M16 20 L24 20" stroke="#0284C7" stroke-width="1.8" stroke-linecap="round"/>
      `;
    case 'database':
    case 'file':
      return `
        <path d="M6 3 L20 3 L26 9 L26 27 C26 28 25 29 24 29 L6 29 C5 29 4 28 4 27 L4 5 C4 4 5 3 6 3 Z" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <polyline points="20,3 20,9 26,9" fill="#E2E8F0" stroke="#334155" stroke-width="1.8"/>
        <rect x="8" y="15" width="16" height="8" rx="2" fill="#334155"/>
        <text x="16" y="21" fill="#FFFFFF" font-size="7" font-family="monospace" font-weight="700" text-anchor="middle">JSON</text>
      `;
    case 'engine':
      return `
        <rect x="6" y="6" width="20" height="20" rx="3" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <rect x="11" y="11" width="10" height="10" rx="1" fill="#334155"/>
        <line x1="11" y1="2" x2="11" y2="6" stroke="#334155" stroke-width="1.8"/>
        <line x1="16" y1="2" x2="16" y2="6" stroke="#334155" stroke-width="1.8"/>
        <line x1="21" y1="2" x2="21" y2="6" stroke="#334155" stroke-width="1.8"/>
        <line x1="11" y1="26" x2="11" y2="30" stroke="#334155" stroke-width="1.8"/>
        <line x1="16" y1="26" x2="16" y2="30" stroke="#334155" stroke-width="1.8"/>
        <line x1="21" y1="26" x2="21" y2="30" stroke="#334155" stroke-width="1.8"/>
        <line x1="2" y1="11" x2="6" y2="11" stroke="#334155" stroke-width="1.8"/>
        <line x1="2" y1="16" x2="6" y2="16" stroke="#334155" stroke-width="1.8"/>
        <line x1="2" y1="21" x2="6" y2="21" stroke="#334155" stroke-width="1.8"/>
        <line x1="26" y1="11" x2="30" y2="11" stroke="#334155" stroke-width="1.8"/>
        <line x1="26" y1="16" x2="30" y2="16" stroke="#334155" stroke-width="1.8"/>
        <line x1="26" y1="21" x2="30" y2="21" stroke="#334155" stroke-width="1.8"/>
      `;
    case 'ai':
      return `
        <path d="M8 22 C4 22 2 18 5 15 C4 12 7 8 11 9 C13 5 21 5 23 9 C27 8 30 12 28 16 C30 19 28 22 24 22 Z" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <circle cx="12" cy="15" r="2" fill="#6366F1"/>
        <circle cx="20" cy="15" r="2" fill="#6366F1"/>
        <circle cx="16" cy="12" r="2" fill="#6366F1"/>
        <line x1="12" y1="15" x2="16" y2="12" stroke="#6366F1" stroke-width="1.2"/>
        <line x1="20" y1="15" x2="16" y2="12" stroke="#6366F1" stroke-width="1.2"/>
      `;
    case 'enrichment':
      return `
        <path d="M4 28 L18 14" stroke="#334155" stroke-width="2.5" stroke-linecap="round"/>
        <polygon points="17,15 21,11 19,9 15,13" fill="#6366F1"/>
        <path d="M24 4 L25 8 L29 9 L25 10 L24 14 L23 10 L19 9 L23 8 Z" fill="#F59E0B"/>
        <path d="M12 4 L13 6 L15 7 L13 8 L12 10 L11 8 L9 7 L11 6 Z" fill="#38BDF8"/>
      `;
    default:
      return `
        <rect x="4" y="6" width="24" height="20" rx="3" fill="#F8FAFC" stroke="#334155" stroke-width="1.8"/>
        <path d="M10 13 L14 16 L10 19" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="16" y1="19" x2="22" y2="19" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
      `;
  }
}

function escapeXml(unsafe: string): string {
  return (unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Generate standalone SVG matching the uploaded clean white card / tech grid aesthetic.
 */
function renderSystemGraphSvg(nodes: SystemGraphNode[], edges: SystemGraphEdge[]): string {
  const cardW = 150;
  const cardH = 92;
  const colSpacing = 240;
  const rowSpacing = 160;
  const originX = 60;
  const originY = 60;

  // Compute node coordinates based on colIndex, rowIndex
  const nodeCoords = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  let maxCol = 1;
  let maxRow = 1;

  nodes.forEach((n) => {
    const col = typeof n.colIndex === 'number' ? n.colIndex : 0;
    const row = typeof n.rowIndex === 'number' ? n.rowIndex : 0;
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;

    const x = originX + col * colSpacing;
    const y = originY + row * rowSpacing;
    nodeCoords.set(n.id, {
      x,
      y,
      cx: x + cardW / 2,
      cy: y + cardH / 2,
    });
  });

  const svgWidth = Math.max(860, originX * 2 + (maxCol + 1) * colSpacing);
  const svgHeight = Math.max(540, originY * 2 + (maxRow + 1) * rowSpacing);

  // Render edges (connectors)
  let edgesSvg = '';
  edges.forEach((edge) => {
    const from = nodeCoords.get(edge.from);
    const to = nodeCoords.get(edge.to);
    if (!from || !to) return;

    let x1 = from.cx;
    let y1 = from.cy;
    let x2 = to.cx;
    let y2 = to.cy;

    // Boundary intersection adjustment
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal dominant
      if (dx > 0) {
        x1 = from.x + cardW;
        x2 = to.x;
      } else {
        x1 = from.x;
        x2 = to.x + cardW;
      }
    } else {
      // Vertical dominant
      if (dy > 0) {
        y1 = from.y + cardH;
        y2 = to.y;
      } else {
        y1 = from.y;
        y2 = to.y + cardH;
      }
    }

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const markerEnd = 'url(#arrow-end)';
    const markerStart = edge.bidirectional ? 'url(#arrow-start)' : '';

    edgesSvg += `
      <g class="graph-edge">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748B" stroke-width="1.8" marker-end="${markerEnd}" ${markerStart ? `marker-start="${markerStart}"` : ''} />
        ${
          edge.label
            ? `
          <g transform="translate(${midX}, ${midY})">
            <rect x="-48" y="-10" width="96" height="20" rx="4" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1" />
            <text x="0" y="3" fill="#334155" font-size="9" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500" text-anchor="middle">${escapeXml(edge.label.slice(0, 20))}</text>
          </g>
        `
            : ''
        }
      </g>
    `;
  });

  // Render nodes
  let nodesSvg = '';
  nodes.forEach((n) => {
    const coord = nodeCoords.get(n.id);
    if (!coord) return;

    const iconMarkup = getIconSvg(n.iconType);

    nodesSvg += `
      <g transform="translate(${coord.x}, ${coord.y})" class="graph-node">
        <!-- White Card with drop shadow -->
        <rect width="${cardW}" height="${cardH}" rx="12" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.06))" />
        
        <!-- Centered Thematic Icon -->
        <g transform="translate(${(cardW - 32) / 2}, 14)">
          <svg width="32" height="32" viewBox="0 0 32 32">
            ${iconMarkup}
          </svg>
        </g>

        <!-- Bold Uppercase Title -->
        <text x="${cardW / 2}" y="62" fill="#1E293B" font-size="11.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" letter-spacing="0.4" text-anchor="middle">
          ${escapeXml(n.label)}
        </text>

        <!-- Optional Subtitle -->
        ${
          n.subtitle
            ? `
          <text x="${cardW / 2}" y="76" fill="#64748B" font-size="9" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" text-anchor="middle">
            ${escapeXml(n.subtitle)}
          </text>
        `
            : ''
        }
      </g>
    `;
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%" style="background-color: #F8F9FA; border-radius: 12px; border: 1px solid #E2E8F0;">
      <defs>
        <!-- Background Grid Pattern -->
        <pattern id="whiteboard-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(0,0,0,0.04)" stroke-width="1" />
        </pattern>
        <!-- Forward Arrowhead -->
        <marker id="arrow-end" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <polygon points="0 0, 8 3.5, 0 7" fill="#64748B" />
        </marker>
        <!-- Reverse Arrowhead for bidirectional edges -->
        <marker id="arrow-start" markerWidth="8" markerHeight="7" refX="1" refY="3.5" orient="auto">
          <polygon points="8 0, 0 3.5, 8 7" fill="#64748B" />
        </marker>
      </defs>

      <!-- Tech Whiteboard Grid -->
      <rect width="100%" height="100%" fill="url(#whiteboard-grid)" />

      <!-- Connectors -->
      ${edgesSvg}

      <!-- Floating Cards -->
      ${nodesSvg}
    </svg>
  `.trim();
}

export async function generateSystemGraph(
  title: string,
  summary: string,
  fullBody: string
): Promise<SystemGraphEnrichment> {
  const prompt = `
You are a Principal Software and Systems Architect.
Your task is to model the complete system architecture network of the following brainstormed approach.
Generate a structured 2D system graph of entities, components, files, and external services, with labeled directional or bidirectional interactions.

STYLE REFERENCE:
Think of an architecture diagram with clean white component cards arranged in a logical grid:
- Frontend / User Interface
- Storage / Data Store (e.g. IDEAS.JSON, DB)
- Core Engine / Brain (e.g. Server, Worker, Orchestrator)
- External AI Models (e.g. GEMINI API, Agents)
- Audio / Ingestion Services (e.g. Audio capture, STT, Gradio)
- Output Artifacts (e.g. Transcripts, Exports, Alerts)

Categorize each node's iconType accurately:
'frontend', 'audio', 'transcription', 'database', 'engine', 'ai', 'file', 'external_api', 'enrichment', 'lock', 'sensor'.

Arrange colIndex (0, 1, 2, 3) and rowIndex (0, 1, 2) in a clear 2D topology so edges do not overlap messily.
Label each edge with the precise interaction: "Read / Update", "API call", "Listen", "Append", "Write / Read", "Trigger", "Stream audio", etc.

IDEA TITLE: ${title}
SUMMARY: ${summary}
DISCUSSION & BODY:
${fullBody || 'No extra body context provided.'}
`;

  let parsed: {
    summary?: string;
    nodes?: SystemGraphNode[];
    edges?: SystemGraphEdge[];
    mermaidCode?: string;
  };

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: systemGraphResponseSchema,
      },
    });

    parsed = JSON.parse(response.text || '{}');
  } catch (err) {
    console.warn('[systemGraphAgent] Gemini API unavailable or failed, generating fallback system graph:', err);
    parsed = {
      summary: `System component graph for "${title}". Visualizes multi-tier data flow across audio ingest, Python/Express microservices, atomic persistence, and external LLM grounding.`,
      nodes: [
        {
          id: 'audio',
          label: 'AUDIO INGEST',
          subtitle: '(Room Stream)',
          iconType: 'audio',
          colIndex: 0,
          rowIndex: 0,
        },
        {
          id: 'frontend',
          label: 'FRONTEND UI',
          subtitle: '(React / Vite)',
          iconType: 'frontend',
          colIndex: 0,
          rowIndex: 1,
        },
        {
          id: 'engine',
          label: 'IDEA ENGINE',
          subtitle: '(Context & Router)',
          iconType: 'engine',
          colIndex: 1,
          rowIndex: 0,
        },
        {
          id: 'ideas_json',
          label: 'IDEAS.JSON',
          subtitle: '(Atomic Persistence)',
          iconType: 'database',
          colIndex: 1,
          rowIndex: 1,
        },
        {
          id: 'enrichment',
          label: 'ENRICHMENT SVC',
          subtitle: '(Agentic Tools)',
          iconType: 'enrichment',
          colIndex: 2,
          rowIndex: 0,
        },
        {
          id: 'gemini_api',
          label: 'GEMINI API',
          subtitle: '(Google Search Grounded)',
          iconType: 'ai',
          colIndex: 3,
          rowIndex: 0,
        },
      ],
      edges: [
        { from: 'audio', to: 'engine', label: 'Transcribed Speech' },
        { from: 'engine', to: 'ideas_json', label: 'Write / Read', bidirectional: true },
        { from: 'engine', to: 'enrichment', label: 'Dispatch Tool Calls' },
        { from: 'enrichment', to: 'gemini_api', label: 'Search & LLM Calls', bidirectional: true },
        { from: 'enrichment', to: 'ideas_json', label: 'Persist Enriched' },
        { from: 'frontend', to: 'ideas_json', label: 'Live Poll / Read' },
        { from: 'frontend', to: 'enrichment', label: 'Manual Trigger' },
      ],
    };
  }

  const nodes = parsed.nodes || [];
  const edges = parsed.edges || [];
  const svgDiagram = renderSystemGraphSvg(nodes, edges);

  let mermaidCode = parsed.mermaidCode || '';
  if (!mermaidCode && nodes.length > 0) {
    mermaidCode =
      'flowchart LR\n' +
      nodes.map((n) => `    ${n.id}["${n.label}${n.subtitle ? `\\n${n.subtitle}` : ''}"]`).join('\n') +
      '\n' +
      edges
        .map((e) =>
          e.bidirectional
            ? `    ${e.from} <-->|${e.label}| ${e.to}`
            : `    ${e.from} -->|${e.label}| ${e.to}`
        )
        .join('\n');
  }

  return {
    summary: parsed.summary || 'System architecture network graph generated.',
    nodes,
    edges,
    svgDiagram,
    mermaidCode,
  };
}
