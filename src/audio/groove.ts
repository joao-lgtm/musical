import { DRUM_VOICES } from './types'
import type { DrumVoice } from './types'

/** Usa o primeiro compasso da base sem alterar suas linhas. */
export function fillPattern(base: boolean[][], stepsPerBar = 16): boolean[][] {
  const size = Number.isFinite(stepsPerBar) ? Math.max(0, Math.floor(stepsPerBar)) : 0
  const half = Math.floor(size / 2)
  const pattern = DRUM_VOICES.map((_, voice) => Array.from({ length: size }, (_, step) =>
    step < half && Boolean(base[voice]?.[step])))
  const snare = DRUM_VOICES.indexOf('snare')
  for (const step of [8, 10, 12, 13, 14, 15]) {
    const target = Math.floor(step * size / 16)
    if (target < size) pattern[snare][target] = true
  }
  return pattern
}

export function isFillBar(absoluteBar: number): boolean {
  return Number.isInteger(absoluteBar) && absoluteBar >= 0 && absoluteBar % 4 === 3
}

function hash(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

export function humanize(voice: DrumVoice, absoluteStep: number, seed: number): { velocity: number; offset: number } {
  const id = DRUM_VOICES.indexOf(voice) + 1
  const value = hash((seed | 0) ^ Math.imul(absoluteStep | 0, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b))
  const random = value / 0x100000000
  const strong = absoluteStep % 4 === 0
  const velocity = strong ? 0.95 + random * 0.05 :
    voice === 'hat' && absoluteStep % 2 === 0 ? 0.88 + random * 0.02 : 0.75 + random * 0.15
  const jitter = (hash(value ^ 0xa511e9b3) / 0x100000000 * 2 - 1) * 0.005
  return { velocity, offset: absoluteStep === 0 ? Math.abs(jitter) : jitter }
}
