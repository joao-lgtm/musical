import { describe, expect, it } from 'vitest'
import { hzToMidi, midiToHz, pentatonic, quantizeToScale } from './scale'
import { KEYS } from './types'

describe('scale', () => {
  it('maps pads and transposes every key', () => {
    expect(pentatonic('C')).toEqual([60, 62, 64, 67, 69, 72, 74, 76])
    KEYS.forEach((key, i) => expect(pentatonic(key)).toEqual(pentatonic('C').map(n => n + i)))
    expect(pentatonic('B', 6, 3)).toEqual([59, 61, 63, 66, 68, 71])
    expect(pentatonic('C', 0)).toEqual([])
  })
  it('converts fractional pitches', () => {
    expect(midiToHz(69)).toBe(440)
    for (const midi of [20, 60, 69.3, 100]) expect(hzToMidi(midiToHz(midi))).toBeCloseTo(midi, 10)
  })
  it('quantizes across octaves and resolves ties downward', () => {
    expect(quantizeToScale(61, 'C')).toBe(60)
    expect(quantizeToScale(65.5, 'C')).toBe(64)
    expect(quantizeToScale(71.9, 'C')).toBe(72)
    expect(quantizeToScale(-1, 'C')).toBe(0)
    expect(quantizeToScale(60, 'B')).toBe(59)
  })
})
