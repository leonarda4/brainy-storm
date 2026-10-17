type Recipe = { body: string; eyes: string; speed: number; energy: number; expression: number; loop: boolean }
type Frame = { done: boolean }
declare const motion: {
  sample(recipe: Recipe, seconds: number, profile: number, options: { reducedMotion: boolean }): Frame
}
export default motion
