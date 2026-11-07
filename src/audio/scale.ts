import type { Key } from './types'
import { KEYS } from './types'

const INTERVALS = [0, 2, 4, 7, 9]

export function pentatonic(key: Key, degrees = 8, baseOctave = 4): number[] {
  const root = 12 * (baseOctave + 1) + KEYS.indexOf(key)
  return Array.from({ length: Math.max(0, Math.floor(degrees)) }, (_, i) =>
    root + 12 * Math.floor(i / 5) + INTERVALS[i % 5])
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function quantizeToScale(midi: number, key: Key): number {
  const root = KEYS.indexOf(key)
  const octave = Math.floor((midi - root) / 12)
  let best = root + octave * 12
  for (let o = octave - 1; o <= octave + 1; o++) {
    for (const interval of INTERVALS) {
      const candidate = root + o * 12 + interval
      if (Math.abs(candidate - midi) < Math.abs(best - midi) ||
        (Math.abs(candidate - midi) === Math.abs(best - midi) && candidate < best)) best = candidate
    }
  }
  return best
}
