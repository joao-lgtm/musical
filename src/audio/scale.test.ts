import { describe, expect, it } from 'vitest'
import { hzToMidi, major, midiToHz, padNotes, pentatonic, quantizeToScale, scalePitchClasses, snapToScale } from './scale'
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

describe('escala maior dos pads', () => {
  it('Dó maior em 10 pads cobre Dó4 até Mi5, com Fá e Si', () => {
    expect(major('C')).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76])
  })

  it('padNotes respeita a escala e a oitava', () => {
    expect(padNotes('C', 'pentatonic')).toEqual(pentatonic('C', 8, 4))
    expect(padNotes('G', 'major', 2)[0]).toBe(43)
    expect(padNotes('C', 'major')).toHaveLength(10)
  })
})

describe('encaixar na escala', () => {
  it('classes da escala', () => {
    expect(scalePitchClasses('C', 'pentatonic')).toEqual([0, 2, 4, 7, 9])
    expect(scalePitchClasses('D', 'major')).toEqual([2, 4, 6, 7, 9, 11, 1])
  })

  it('nota na escala não muda; fora dela vai para a mais próxima, empate para baixo', () => {
    expect(snapToScale(64, 'C', 'major')).toBe(64) // Mi
    expect(snapToScale(66, 'C', 'major')).toBe(65) // Fá# → Fá (empate Fá/Sol → baixo)
    expect(snapToScale(65, 'C', 'pentatonic')).toBe(64) // Fá → Mi
    expect(snapToScale(71, 'C', 'pentatonic')).toBe(72) // Si → Dó de cima
    expect(snapToScale(61, 'C', 'pentatonic')).toBe(60) // Dó# → Dó (empate → baixo)
  })
})
