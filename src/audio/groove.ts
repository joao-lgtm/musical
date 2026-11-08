import { DRUM_SLOTS } from './types'
import type { SlotRole } from './types'

/** Usa o primeiro compasso da base sem alterar suas linhas. */
export function fillPattern(base: boolean[][], stepsPerBar = 16): boolean[][] {
  const size = Number.isFinite(stepsPerBar) ? Math.max(0, Math.floor(stepsPerBar)) : 0
  const half = Math.floor(size / 2)
  const pattern = Array.from({ length: Math.min(DRUM_SLOTS, Math.max(4, base.length)) }, (_, voice) => Array.from({ length: size }, (_, step) =>
    step < half && Boolean(base[voice]?.[step])))
  const snare = 1
  for (const step of [8, 10, 12, 13, 14, 15]) {
    const target = Math.floor(step * size / 16)
    if (target < size) pattern[pattern[5] && step >= 13 ? 5 : snare][target] = true
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

export function humanize(role: SlotRole, absoluteStep: number, seed: number): { velocity: number; offset: number } {
  const id = (['kick', 'snare', 'hat', 'perc'] as const).indexOf(role) + 1
  const value = hash((seed | 0) ^ Math.imul(absoluteStep | 0, 0x9e3779b1) ^ Math.imul(id, 0x85ebca6b))
  const random = value / 0x100000000
  const strong = (role === 'kick' || role === 'snare') && absoluteStep % 4 === 0
  const velocity = strong ? 0.95 + random * 0.05 :
    role === 'hat' && absoluteStep % 2 === 0 ? 0.88 + random * 0.02 : 0.75 + random * 0.15
  const jitter = (hash(value ^ 0xa511e9b3) / 0x100000000 * 2 - 1) * (role === 'perc' ? 0.005 : 0.004)
  return { velocity, offset: absoluteStep === 0 ? Math.abs(jitter) : jitter }
}
