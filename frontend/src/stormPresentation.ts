export function stormPresentation(recording: string, ideaCount: number, transcriptCount: number, processingNewIdea: boolean) {
  const recordingActive = recording === 'recording' || recording === 'saving'
  const emptyStormThinking = recordingActive || (processingNewIdea && transcriptCount > 0)
  return { recordingActive, emptyStormThinking, memoInWelcome: ideaCount === 0 && !emptyStormThinking }
}
