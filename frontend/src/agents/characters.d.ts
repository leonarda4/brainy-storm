type Agent = { name: string; color: string; shape: string; motion: number }
type Character = { wrap: HTMLDivElement; avatar: HTMLDivElement; badge: HTMLSpanElement }
declare const characters: {
  create(agent: Agent, shapes: unknown, outlines: unknown): Character
  setSize(character: Character, size: 'compact' | 'medium' | 'featured'): void
  render(character: Character, frame: { done: boolean }): void
}
export default characters
