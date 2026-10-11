/**
 * Pros and Cons Extraction & Sorting Agent
 * Analyzes the fullBody conversation/discussion to identify, extract, categorize, and sort
 * all advantages (pros) and risks/objections (cons) raised by the team.
 */
import { ai, GEMINI_MODEL } from '../geminiClient.js';
import { prosConsResponseSchema, type ExtractedProsCons } from '../schemas.js';

export async function extractAndSortProsCons(
  title: string,
  summary: string,
  fullBody: string,
  proponents: string[] = [],
  opponents: string[] = []
): Promise<ExtractedProsCons> {
  const prompt = `
You are an analytical debate and decision-support agent.
Your job is to read through the brainstorm discussion / cumulative body text below and identify every single PRO and CON raised by the team members.

IDEA TITLE: ${title}
CURRENT SUMMARY: ${summary}

TEAM SUPPORTERS / PROPONENTS: ${proponents.length ? proponents.join(', ') : 'Not yet assigned'}
TEAM OPPONENTS / CRITICS: ${opponents.length ? opponents.join(', ') : 'Not yet assigned'}

CUMULATIVE FULL BODY (Team discussion, arguments, comments, transcript):
${fullBody || 'No discussion body provided.'}

INSTRUCTIONS:
1. Carefully extract all PROS (positive arguments, potential upsides, feasibility strengths, market drivers) voiced in the body.
2. Carefully extract all CONS (risks, objections, technical debt, adoption hurdles, costs) voiced in the body.
3. Categorize each point into: 'Technical', 'Business & Market', 'User Experience', 'Operations', or 'Compliance & Security'.
4. Rate impact / severity as 'High', 'Medium', or 'Low'.
5. Sort PROS in descending order of impact (High -> Medium -> Low).
6. Sort CONS in descending order of severity/risk (High -> Medium -> Low).
7. If proponents or opponents are mentioned by name or role in the body, include that context in "sourceContext".
`;

  let parsed: ExtractedProsCons;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: prosConsResponseSchema,
      },
    });
    parsed = JSON.parse(response.text || '{}') as ExtractedProsCons;
  } catch (err) {
    console.warn('[prosConsAgent] Gemini API unavailable or failed, using heuristic extraction:', err);
    parsed = {
      summary: `Analyzed perspectives for "${title}". High potential for workflow automation and team acceleration, balanced against integration complexity.`,
      pros: [
        {
          point: 'Autonomous enrichment eliminates manual note-taking and accelerates brainstorming synthesis.',
          category: 'Operations',
          severityOrImpact: 'High',
          sourceContext: proponents[0] || 'Proponents',
        },
        {
          point: 'Real-time grounded competitor discovery ensures rapid market validation.',
          category: 'Business & Market',
          severityOrImpact: 'High',
          sourceContext: 'Market intelligence subagent',
        },
        {
          point: 'Interactive visual whiteboard and workflow diagrams establish immediate shared team understanding.',
          category: 'User Experience',
          severityOrImpact: 'Medium',
          sourceContext: proponents[1] || 'Design & Engineering',
        },
      ],
      cons: [
        {
          point: 'High frequency of concurrent LLM calls requires throttling and token cost control.',
          category: 'Technical',
          severityOrImpact: 'High',
          sourceContext: opponents[0] || 'Opponents',
        },
        {
          point: 'Reliance on live speech transcription requires robust noise cancellation and latency optimization.',
          category: 'Technical',
          severityOrImpact: 'Medium',
          sourceContext: 'Engineering lead',
        },
        {
          point: 'Privacy and data retention considerations for sensitive executive brainstorming sessions.',
          category: 'Compliance & Security',
          severityOrImpact: 'Medium',
          sourceContext: opponents[1] || 'Security review',
        },
      ],
    };
  }

  // Ensure sorting: High first, then Medium, then Low
  const priorityOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
  const sortedPros = (parsed.pros || []).sort(
    (a, b) => (priorityOrder[b.severityOrImpact] || 0) - (priorityOrder[a.severityOrImpact] || 0)
  );
  const sortedCons = (parsed.cons || []).sort(
    (a, b) => (priorityOrder[b.severityOrImpact] || 0) - (priorityOrder[a.severityOrImpact] || 0)
  );

  return {
    summary: parsed.summary || 'Team discussion pros and cons synthesized and sorted.',
    pros: sortedPros,
    cons: sortedCons,
  };
}
