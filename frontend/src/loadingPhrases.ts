/** Shared vocabulary: add a purpose here to reuse playful status copy anywhere. */
export const loadingWords = {
  thinking: ['detangling', 'thinking', 'connecting the dots', 'untangling thoughts', 'chasing a spark', 'putting two and two together', 'noodling', 'finding the thread'],
  research: ['following breadcrumbs', 'scouting possibilities', 'digging a little deeper', 'joining the dots'],
  writing: ['weaving words', 'shaping the story', 'polishing a thought', 'finding the right words'],
  organizing: ['sorting the sparks', 'making room for ideas', 'gathering the threads', 'lining things up'],
} as const
export type LoadingPurpose = keyof typeof loadingWords

/** Pure and usable outside React. Pass the previous word to avoid consecutive repeats. */
export function nextLoadingWord(purpose: LoadingPurpose = 'thinking', previous?: string, random = Math.random): string {
  const choices = loadingWords[purpose].filter(word => word !== previous)
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))]
}
export function formatLoadingPhrase(subject: string, word: string) {
  return `${subject.trim()} is ${word}…`
}
