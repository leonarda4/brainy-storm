/**
 * Data models and Gemini response schemas for the Idea Enrichment Engine
 */
import { Type } from '@google/genai';

export interface CompetitorItem {
  name: string;
  idea: string;
  yearOfFounding: string;
  shortBio: string;
  howWeDiffer: string;
}

export interface CompetitorAnalysis {
  summary: string;
  competitors: CompetitorItem[];
  groundingSources?: Array<{ title: string; url: string }>;
}

export interface ProConItem {
  point: string;
  category: string; // e.g., 'Technical Feasibility', 'Market & Business', 'User Experience', 'Operations', 'Compliance'
  severityOrImpact: 'High' | 'Medium' | 'Low';
  sourceContext?: string;
}

export interface ExtractedProsCons {
  summary: string;
  pros: ProConItem[];
  cons: ProConItem[];
}

export interface DiagramNode {
  id: string;
  title: string;
  description: string;
  role: string;
  type: 'input' | 'process' | 'decision' | 'output';
}

export interface DiagramConnection {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramEnrichment {
  summary: string;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  svgDiagram: string;
  mermaidCode?: string;
}

export interface SystemGraphNode {
  id: string;
  label: string; // Uppercase title like "FRONTEND", "IDEAS.JSON", "ENGINE", "GEMINI API"
  subtitle?: string; // Optional e.g. "(Speech to Text)"
  iconType: 'frontend' | 'audio' | 'transcription' | 'database' | 'engine' | 'ai' | 'file' | 'external_api' | 'enrichment' | 'lock' | 'sensor';
  colIndex: number; // 0, 1, 2, 3 (for structured spatial alignment)
  rowIndex: number; // 0, 1, 2 (vertical layout position)
}

export interface SystemGraphEdge {
  from: string;
  to: string;
  label: string; // e.g. "Read / Update", "Listen", "API call", "Append", "Write / Read"
  bidirectional?: boolean;
}

export interface SystemGraphEnrichment {
  summary: string;
  nodes: SystemGraphNode[];
  edges: SystemGraphEdge[];
  svgDiagram: string;
  mermaidCode?: string;
}

export interface IdeaModel {
  id: string;
  title: string;
  summary: string;
  fullBody: string; // Continuous conversation, notes, raw transcript fed from frontend
  proponents: string[]; // Team members supporting (e.g. ['Sarah (Lead Eng)', 'Marcus (Product)'])
  opponents: string[]; // Team members challenging (e.g. ['Dave (Security)', 'Elena (Ops)'])
  createdAt: number;
  updatedAt: number;

  // Enriched sections
  prosAndCons?: ExtractedProsCons;
  diagram?: DiagramEnrichment;
  systemGraph?: SystemGraphEnrichment;
  competitors?: CompetitorAnalysis;
}

// Gemini Response Schema for Pros and Cons extraction from fullBody
export const prosConsResponseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Overall synthesis of the team sentiments and trade-offs voiced in the body.',
    },
    pros: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING, description: 'The specific advantage or opportunity raised by the team.' },
          category: { type: Type.STRING, description: 'Category: Technical, Market/Business, User Experience, Ops, or Financial.' },
          severityOrImpact: { type: Type.STRING, description: 'Impact level: High, Medium, or Low.' },
          sourceContext: { type: Type.STRING, description: 'Brief mention or snippet from the body reflecting this point.' },
        },
        required: ['point', 'category', 'severityOrImpact'],
      },
      description: 'Pros and advantages identified from the discussion in the body, sorted by impact.',
    },
    cons: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING, description: 'The specific risk, objection, or bottleneck raised by the team.' },
          category: { type: Type.STRING, description: 'Category: Technical, Market/Business, User Experience, Ops, or Financial.' },
          severityOrImpact: { type: Type.STRING, description: 'Risk level: High, Medium, or Low.' },
          sourceContext: { type: Type.STRING, description: 'Brief mention or snippet from the body reflecting this point.' },
        },
        required: ['point', 'category', 'severityOrImpact'],
      },
      description: 'Cons and risks identified from the discussion in the body, sorted by severity.',
    },
  },
  required: ['summary', 'pros', 'cons'],
};

// Gemini Response Schema for Diagram Generation
export const diagramResponseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'High-level operational overview of the system/workflow diagram.',
    },
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'Short node ID (e.g. node_1, node_2).' },
          title: { type: Type.STRING, description: 'Short title of the step/module.' },
          description: { type: Type.STRING, description: 'Operational description.' },
          role: { type: Type.STRING, description: 'Executing agent, service, or actor.' },
          type: {
            type: Type.STRING,
            description: 'Node type: input, process, decision, or output.',
          },
        },
        required: ['id', 'title', 'description', 'role', 'type'],
      },
    },
    connections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          from: { type: Type.STRING, description: 'Source node id.' },
          to: { type: Type.STRING, description: 'Target node id.' },
          label: { type: Type.STRING, description: 'Optional trigger condition or data flow description.' },
        },
        required: ['from', 'to'],
      },
    },
    mermaidCode: {
      type: Type.STRING,
      description: 'Clean, professional Mermaid flowchart syntax (flowchart LR or flowchart TD) with styled nodes and labeled connections.',
    },
  },
  required: ['summary', 'nodes', 'connections'],
};

// Gemini Response Schema for Summary Generation
export const summaryResponseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'A crisp, high-impact 2-3 sentence executive summary distilling the full idea and current discussion.',
    },
    keyTakeaway: {
      type: Type.STRING,
      description: 'The single most critical takeaway or next step decided by the team.',
    },
  },
  required: ['summary', 'keyTakeaway'],
};

// Backwards-compatible aliases and transcript extraction schema
export type IdeaBoilerplate = IdeaModel;
export type DebateEnrichment = ExtractedProsCons;
export const debateResponseSchema = prosConsResponseSchema;

export interface TranscriptExtractedIdea {
  title: string;
  summary: string;
  rawContext: string;
  initialProponents?: string[];
  initialOpponents?: string[];
}

export interface TranscriptExtractionResult {
  sessionSummary: string;
  extractedIdeas: TranscriptExtractedIdea[];
}

export const transcriptExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    sessionSummary: { type: Type.STRING },
    extractedIdeas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          rawContext: { type: Type.STRING },
          initialProponents: { type: Type.ARRAY, items: { type: Type.STRING } },
          initialOpponents: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'summary', 'rawContext'],
      },
    },
  },
  required: ['sessionSummary', 'extractedIdeas'],
};

// Gemini Response Schema for Spatial System Graph Generation (matching uploaded diagram style)
export const systemGraphResponseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Concise summary of the system architecture network.',
    },
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'Short unique node ID (e.g. frontend, ideas_json, engine, gemini_api, audio, transcription).' },
          label: { type: Type.STRING, description: 'Uppercase short label (e.g. FRONTEND, IDEAS.JSON, ENGINE, GEMINI API, AUDIO, TRANSCRIPTION).' },
          subtitle: { type: Type.STRING, description: 'Optional short descriptor under the label, e.g. (Speech to Text).' },
          iconType: {
            type: Type.STRING,
            description: 'One of: frontend, audio, transcription, database, engine, ai, file, external_api, enrichment, lock, sensor.',
          },
          colIndex: { type: Type.INTEGER, description: 'Column index in grid (0 to 4).' },
          rowIndex: { type: Type.INTEGER, description: 'Row index in grid (0 to 3).' },
        },
        required: ['id', 'label', 'iconType', 'colIndex', 'rowIndex'],
      },
    },
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          from: { type: Type.STRING, description: 'Source node id.' },
          to: { type: Type.STRING, description: 'Target node id.' },
          label: { type: Type.STRING, description: 'Interaction label e.g. Read / Update, API call, Listen, Append, Write / Read.' },
          bidirectional: { type: Type.BOOLEAN, description: 'True if two-way communication / arrows on both ends.' },
        },
        required: ['from', 'to', 'label'],
      },
    },
    mermaidCode: {
      type: Type.STRING,
      description: 'Clean Mermaid flowchart syntax matching this architecture.',
    },
  },
  required: ['summary', 'nodes', 'edges'],
};
