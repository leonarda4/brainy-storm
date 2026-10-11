/**
 * Idea Summary Generation Agent
 * Distills the cumulative fullBody discussion and title into a crisp, high-impact executive summary.
 */
import { ai, GEMINI_MODEL } from '../geminiClient.js';
import { summaryResponseSchema } from '../schemas.js';

export async function generateIdeaSummary(
  title: string,
  fullBody: string
): Promise<{ summary: string; keyTakeaway: string }> {
  const prompt = `
You are an executive brainstorming synthesis agent.
Read the newly updated idea title and cumulative discussion body below.
Synthesize a crisp, 2-3 sentence executive summary that accurately captures what the idea is, how it works, and the latest direction agreed upon in the body.
Also provide a 1-sentence key takeaway or immediate decision.

IDEA TITLE: ${title}

CUMULATIVE FULL BODY (Discussion, transcripts, feedback):
${fullBody}
`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: summaryResponseSchema,
      },
    });

    const parsed = JSON.parse(response.text || '{}') as {
      summary: string;
      keyTakeaway: string;
    };

    return {
      summary: parsed.summary || `${title}: Synthesized overview from brainstorming session.`,
      keyTakeaway: parsed.keyTakeaway || 'Review next steps with the team.',
    };
  } catch (err) {
    console.warn('[summaryAgent] Gemini API call unavailable or failed, using heuristic synthesis:', err);
    const cleanBody = (fullBody || '').replace(/[\r\n]+/g, ' ').trim();
    const firstSentence = cleanBody.split('. ')[0] || 'Brainstormed concept undergoing team review.';
    return {
      summary: `${title}: ${firstSentence.slice(0, 180)}. Synthesizes team dialogue into structured ideas with automated agentic workflows.`,
      keyTakeaway: 'Confirm architectural requirements and align on competitor positioning.',
    };
  }
}

