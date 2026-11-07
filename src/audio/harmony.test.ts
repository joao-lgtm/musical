import { describe, expect, it } from 'vitest'
import { accompany } from './harmony'
import type { Note } from './transcribe'

const melody = (midis: number[], step = 0, length = 2): Note[] => midis.map((midi, i) => ({ step: step + i * length, length, midi }))

describe('accompany', () => {
  it('detecta Do maior e prefere I para C E G', () => {
    const result = accompany(melody([60, 64, 67, 60]), 120, 1)
    expect(result.key).toBe('C')
    expect(result.chords.map(chord => chord.name)).toEqual(['C', 'C'])
    expect(result.chords[0].midis).toEqual([60, 64, 67])
  })
  it('escolhe vi quando a melodia do trecho favorece A C E', () => {
    const result = accompany([...melody([60, 64, 67, 71, 65, 67, 62, 60]), ...melody([69, 72, 76, 69], 16, 4)], 120, 2)
    expect(result.key).toBe('C')
    expect(result.chords[1].name).toBe('Am')
  })
  it('detecta Re maior sem receber o tom do projeto', () => {
    const result = accompany(melody([62, 66, 69, 62, 64, 66, 73, 62]), 120, 1)
    expect(result.key).toBe('D')
    expect(result.chords[0].name).toBe('D')
  })
  it.each([1, 2, 4] as const)('gera duracoes e quantidade de acordes corretas para %i compasso(s)', bars => {
    const bpm = 100, seconds = 15 / bpm
    const result = accompany(melody([60, 64, 67]), bpm, bars)
    expect(result.chords).toHaveLength(bars === 1 ? 2 : bars)
    expect(result.chordNotes).toHaveLength(result.chords.length * 3)
    result.chords.forEach((chord, i) => {
      expect(chord.step).toBe(i * (bars === 1 ? 8 : 16))
      expect(chord.length).toBe(bars === 1 ? 8 : 16)
      expect(result.chordNotes.slice(i * 3, i * 3 + 3)).toEqual(chord.midis.map(midi => ({ time: chord.step * seconds, duration: chord.length * seconds, midi })))
    })
    expect(result.bassNotes).toHaveLength(bars * 2)
  })
  it('repete o acorde anterior no trecho sem melodia e usa I no silencio total', () => {
    const result = accompany(melody([60, 64, 67]), 120, 4)
    expect(new Set(result.chords.map(chord => chord.name))).toEqual(new Set(['C']))
    const empty = accompany([], 120, 1)
    expect(empty.key).toBe('C')
    expect(empty.chords.map(chord => chord.name)).toEqual(['C', 'C'])
  })
  it('conduz suavemente as vozes entre acordes', () => {
    const notes = [
      ...melody([60, 64, 67, 60], 0, 4), ...melody([67, 71, 74, 67], 16, 4),
      ...melody([69, 72, 76, 69], 32, 4), ...melody([65, 69, 72, 65], 48, 4),
    ]
    const result = accompany(notes, 120, 4)
    expect(result.key).toBe('C')
    expect(result.chords.map(chord => chord.name)).toEqual(['C', 'G', 'Am', 'F'])
    for (let i = 1; i < result.chords.length; i++) {
      result.chords[i].midis.forEach((midi, voice) => expect(Math.abs(midi - result.chords[i - 1].midis[voice])).toBeLessThanOrEqual(5))
    }
  })
  it('toca fundamental no tempo 1 e quinta no tempo 3 por um tempo', () => {
    const result = accompany(melody([60, 64, 67]), 120, 2)
    expect(result.bassNotes).toEqual([
      { time: 0, duration: 0.5, midi: 36 }, { time: 1, duration: 0.5, midi: 43 },
      { time: 2, duration: 0.5, midi: 36 }, { time: 3, duration: 0.5, midi: 43 },
    ])
  })
  it('resolve empate entre tons pelo menor numero de acidentes', () => {
    expect(accompany(melody(Array.from({ length: 12 }, (_, i) => 60 + i), 0, 1), 120, 1).key).toBe('C')
  })
  it('mantem fundamentais e quintas na oitava 2 mesmo em Re', () => {
    const result = accompany(melody([62, 66, 69, 62, 64, 66, 73, 62]), 120, 1)
    expect(result.bassNotes[0].midi).toBe(38)
    expect(result.bassNotes.every(note => note.midi >= 36 && note.midi < 48)).toBe(true)
    const chord = result.chords[1]
    const root = chord.name === 'D' ? 2 : null
    if (root !== null) expect(result.bassNotes[1].midi).toBe(45)
  })
  it('pondera o tom por duracao e recorta notas nas bordas sem mutar a entrada', () => {
    const notes = [...melody([60, 64, 67], 0, 4), { step: 15.5, length: 100, midi: 61 }, { step: 100, length: 100, midi: 61 }]
    const original = structuredClone(notes)
    expect(accompany(notes, 120, 1).key).toBe('C')
    expect(notes).toEqual(original)
  })
})
