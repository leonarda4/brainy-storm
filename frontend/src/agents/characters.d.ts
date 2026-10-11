type Agent = { name: string; color: string; shape: string; motion: number }
type Character = { wrap: HTMLDivElement }
declare const characters: {
  create(agent: Agent, shapes: unknown, outlines: unknown): Character
  setSize(character: Character, size: 'medium' | 'featured'): void
  render(character: Character, frame: { done: boolean }): void
}
export default characters
