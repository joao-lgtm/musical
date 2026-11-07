import type { Key, PadScale } from './types'
import { KEYS, PAD_COUNT } from './types'

const INTERVALS = [0, 2, 4, 7, 9]

export function pentatonic(key: Key, degrees = 8, baseOctave = 4): number[] {
  const root = 12 * (baseOctave + 1) + KEYS.indexOf(key)
  return Array.from({ length: Math.max(0, Math.floor(degrees)) }, (_, i) =>
    root + 12 * Math.floor(i / 5) + INTERVALS[i % 5])
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** Escala maior a partir da tônica: graus 0..degrees-1, subindo oitavas a cada 7 graus. */
export function major(key: Key, degrees = 10, baseOctave = 4): number[] {
  const root = 12 * (baseOctave + 1) + KEYS.indexOf(key)
  return Array.from({ length: Math.max(0, Math.floor(degrees)) }, (_, i) =>
    root + 12 * Math.floor(i / 7) + MAJOR[i % 7])
}

/** Notas MIDI dos pads para a escala escolhida (PAD_COUNT[scale] pads). */
export function padNotes(key: Key, scale: PadScale, baseOctave = 4): number[] {
  return scale === 'major' ? major(key, PAD_COUNT.major, baseOctave) : pentatonic(key, PAD_COUNT.pentatonic, baseOctave)
}

/** Classes de altura (0..11) da escala dos pads no tom. */
export function scalePitchClasses(key: Key, scale: PadScale): number[] {
  const root = KEYS.indexOf(key)
  return (scale === 'major' ? MAJOR : INTERVALS).map((i) => (root + i) % 12)
}

/** A nota da escala mais próxima de midi, em qualquer oitava (empate → a de baixo). Nota já na escala volta igual. */
export function snapToScale(midi: number, key: Key, scale: PadScale): number {
  const classes = scalePitchClasses(key, scale)
  const m = Math.round(midi)
  for (let d = 0; d <= 6; d++) {
    if (classes.includes((((m - d) % 12) + 12) % 12)) return m - d
    if (classes.includes((((m + d) % 12) + 12) % 12)) return m + d
  }
  return m
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
