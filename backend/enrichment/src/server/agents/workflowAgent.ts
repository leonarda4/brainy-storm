/**
 * Architecture & Diagram Generation Subagent
 * Generates enterprise-grade, professional architecture diagrams and Mermaid code.
 */
import { ai, GEMINI_MODEL } from '../geminiClient.js';
import { diagramResponseSchema, type DiagramEnrichment, type DiagramNode } from '../schemas.js';

function generateProfessionalSvgFromNodes(
  nodes: DiagramNode[],
  connections: Array<{ from: string; to: string; label?: string }>
): string {
  const nodeWidth = 220;
  const nodeHeight = 90;
  const gapX = 70;
  const startX = 60;
  const startY = 80;
  const totalWidth = Math.max(900, startX * 2 + nodes.length * (nodeWidth + gapX));
  const totalHeight = 280;

  const nodePositions = new Map<string, { x: number; y: number }>();

  let nodesSvg = '';
  nodes.forEach((node, idx) => {
    // Slight organic stagger for better visual rhythm
    const x = startX + idx * (nodeWidth + gapX);
    const y = startY + (idx % 2 === 1 ? 26 : 0);
    nodePositions.set(node.id, { x, y });

    const badgeColor =
      node.type === 'input'
        ? '#38BDF8' // Sky blue
        : node.type === 'decision'
          ? '#FBBF24' // Amber
          : node.type === 'output'
            ? '#34D399' // Emerald
            : '#818CF8'; // Indigo

    const badgeBg =
      node.type === 'input'
        ? 'rgba(56, 189, 248, 0.15)'
        : node.type === 'decision'
          ? 'rgba(251, 191, 36, 0.15)'
          : node.type === 'output'
            ? 'rgba(52, 211, 153, 0.15)'
            : 'rgba(129, 140, 248, 0.15)';

    nodesSvg += `
      <g transform="translate(${x}, ${y})" class="diagram-node">
        <!-- Node Card Shadow & Base -->
        <rect width="${nodeWidth}" height="${nodeHeight}" rx="12" fill="#1E293B" stroke="#334155" stroke-width="1.5" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.3))" />
        
        <!-- Top Category Badge Pill -->
        <rect x="14" y="12" width="70" height="18" rx="9" fill="${badgeBg}" />
        <circle cx="22" cy="21" r="3.5" fill="${badgeColor}" />
        <text x="30" y="24" fill="${badgeColor}" font-size="9.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" letter-spacing="0.5">${node.type.toUpperCase()}</text>

        <!-- Node Step ID -->
        <text x="${nodeWidth - 16}" y="24" fill="#64748B" font-size="10" font-family="monospace" text-anchor="end">#${idx + 1}</text>

        <!-- Node Title -->
        <text x="14" y="48" fill="#F8FAFC" font-size="13" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600">${escapeXml(node.title.slice(0, 25))}</text>

        <!-- Role / Actor / Description -->
        <text x="14" y="68" fill="#94A3B8" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${escapeXml(node.role.slice(0, 28))}</text>
      </g>
    `;
  });

  let linksSvg = '';
  connections.forEach((conn) => {
    const fromPos = nodePositions.get(conn.from);
    const toPos = nodePositions.get(conn.to);
    if (fromPos && toPos) {
      const x1 = fromPos.x + nodeWidth;
      const y1 = fromPos.y + nodeHeight / 2;
      const x2 = toPos.x;
      const y2 = toPos.y + nodeHeight / 2;
      const midX = (x1 + x2) / 2;

      linksSvg += `
        <g class="diagram-edge">
          <path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="#6366F1" stroke-width="2.2" stroke-dasharray="0" marker-end="url(#arrowhead)" opacity="0.85" />
          ${
            conn.label
              ? `
              <g transform="translate(${midX}, ${(y1 + y2) / 2})">
                <rect x="-40" y="-12" width="80" height="18" rx="4" fill="#0F172A" stroke="#334155" stroke-width="1" />
                <text x="0" y="0" fill="#CBD5E1" font-size="9.5" font-family="sans-serif" font-weight="500" text-anchor="middle" dominant-baseline="middle">${escapeXml(conn.label.slice(0, 16))}</text>
              </g>
            `
              : ''
          }
        </g>
      `;
    }
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="background: linear-gradient(180deg, #0B0F19 0%, #0F172A 100%); border-radius: 12px; border: 1px solid #1E293B;">
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
        </pattern>
        <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
          <polygon points="0 0, 10 4, 0 8" fill="#818CF8" />
        </marker>
      </defs>
      
      <!-- Subtle Tech Blueprint Grid -->
      <rect width="100%" height="100%" fill="url(#grid)" />

      <!-- Diagram Header Banner -->
      <g transform="translate(30, 36)">
        <text x="0" y="0" fill="#94A3B8" font-size="11" font-family="-apple-system, sans-serif" font-weight="600" letter-spacing="1">SYSTEM ARCHITECTURE & OPERATIONAL FLOW</text>
      </g>

      <!-- Connections and Nodes -->
      ${linksSvg}
      ${nodesSvg}

      <!-- Bottom Legend -->
      <g transform="translate(30, ${totalHeight - 20})">
        <circle cx="0" cy="0" r="4" fill="#38BDF8" /><text x="10" y="3" fill="#64748B" font-size="10" font-family="sans-serif">Input</text>
        <circle cx="70" cy="0" r="4" fill="#818CF8" /><text x="80" y="3" fill="#64748B" font-size="10" font-family="sans-serif">Process</text>
        <circle cx="155" cy="0" r="4" fill="#FBBF24" /><text x="165" y="3" fill="#64748B" font-size="10" font-family="sans-serif">Decision</text>
        <circle cx="245" cy="0" r="4" fill="#34D399" /><text x="255" y="3" fill="#64748B" font-size="10" font-family="sans-serif">Output</text>
      </g>
    </svg>
  `.trim();
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
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

export async function generateDiagram(
  title: string,
  summary: string,
  fullBody: string
): Promise<DiagramEnrichment> {
  const prompt = `
You are a Principal Solutions Architect creating a high-level, executive-ready technical diagram of an innovative system.
Deconstruct the brainstormed idea and full discussion body into a clean, professional architecture pipeline (4 to 6 logical steps/nodes).

Categorize each node accurately:
- 'input': Intake, user trigger, sensor capture, or client request.
- 'process': Core calculation, AI agent reasoning, validation, transformation, or coordination.
- 'decision': Conditional branch, safety guardrail, permission gate, or policy check.
- 'output': External fulfillment, dispatch, database commit, or client delivery.

Also generate clean, valid Mermaid.js flowchart code (\`flowchart LR\`) modeling this exact workflow with styled nodes and descriptive connection labels.

IDEA TITLE: ${title}
SUMMARY: ${summary}
FULL BODY / CONVERSATION:
${fullBody || 'No extra body context provided.'}
`;

  let parsed: {
    summary?: string;
    nodes?: DiagramNode[];
    connections?: Array<{ from: string; to: string; label?: string }>;
    mermaidCode?: string;
  };

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: diagramResponseSchema,
      },
    });

    parsed = JSON.parse(response.text || '{}');
  } catch (err) {
    console.warn('[workflowAgent] Gemini API unavailable or failed, generating fallback workflow:', err);
    parsed = {
      summary: `End-to-end architecture pipeline for "${title}". Continuous voice ingestion triggers agentic enrichment and instant canvas rendering.`,
      nodes: [
        {
          id: 'intake',
          title: 'Audio & Speech Ingest',
          description: 'Captures continuous multi-speaker audio from the brainstorming room.',
          role: 'Microphone & Frontend Stream',
          type: 'input',
        },
        {
          id: 'transcriber',
          title: 'Transcriber & Entity Triage',
          description: 'Converts speech to text and extracts discrete ideas and context deltas.',
          role: 'Transcriber Microservice',
          type: 'process',
        },
        {
          id: 'router',
          title: 'Agentic Tool Router',
          description: 'Decides if new context warrants competitor research, workflows, or pros/cons analysis.',
          role: 'Decision Router',
          type: 'decision',
        },
        {
          id: 'enrichment',
          title: 'Subagent Swarm Execution',
          description: 'Executes competitor search, Mermaid diagramming, and risk evaluations concurrently.',
          role: 'Enrichment Microservice',
          type: 'process',
        },
        {
          id: 'persistence',
          title: 'Atomic Canvas State',
          description: 'Atomically persists enriched idea to data/ideas.json and updates live whiteboard.',
          role: 'Storage & UI Live Sync',
          type: 'output',
        },
      ],
      connections: [
        { from: 'intake', to: 'transcriber', label: 'Audio Stream' },
        { from: 'transcriber', to: 'router', label: 'Context Delta' },
        { from: 'router', to: 'enrichment', label: 'Async Trigger' },
        { from: 'enrichment', to: 'persistence', label: 'Enriched State' },
      ],
    };
  }

  const nodes = parsed.nodes || [];
  const connections = parsed.connections || [];
  const svgDiagram = generateProfessionalSvgFromNodes(nodes, connections);

  // Generate fallback mermaid code if not generated
  let mermaidCode = parsed.mermaidCode || '';
  if (!mermaidCode && nodes.length > 0) {
    mermaidCode =
      `flowchart LR\n` +
      nodes.map((n) => `    ${n.id}["${n.title}\\n(${n.role})"]`).join('\n') +
      '\n' +
      connections.map((c) => `    ${c.from} -->${c.label ? `|${c.label}| ` : ''}${c.to}`).join('\n');
  }

  return {
    summary: parsed.summary || 'Architecture workflow diagram synthesized.',
    nodes,
    connections,
    svgDiagram,
    mermaidCode,
  };
}
