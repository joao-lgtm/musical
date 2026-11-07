import { describe, expect, it, vi } from 'vitest'
import { accompany, progression } from './harmony'
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

describe('progression', () => {
  it.each([
    ['pop', ['C', 'G', 'Am', 'F'], ['G', 'D', 'Em', 'C']],
    ['lofi', ['Dm', 'G', 'C', 'Am'], ['Am', 'D', 'G', 'Em']],
    ['reggaeton', ['Am', 'F', 'C', 'G'], ['Em', 'C', 'G', 'D']],
    ['funk', ['C', 'C', 'F', 'C'], ['G', 'G', 'C', 'G']],
  ] as const)('usa os graus de %s em C e G', (style, cNames, gNames) => {
    expect(progression('C', 120, 4, style, 0).chords.map(chord => chord.name)).toEqual(cNames)
    expect(progression('G', 120, 4, style, 0).chords.map(chord => chord.name)).toEqual(gNames)
  })
  it.each(['pop', 'funk', 'reggaeton', 'lofi'] as const)('%s tem tres variacoes deterministicas sem Math.random', style => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random proibido') })
    try {
      const variations = [0, 1, 2].map(seed => progression('C', 120, 4, style, seed))
      expect(new Set(variations.map(result => JSON.stringify(result.chords.map(chord => chord.name)))).size).toBe(3)
      expect(progression('C', 120, 4, style, 123)).toEqual(progression('C', 120, 4, style, 123))
      expect(progression('C', 120, 4, style, -1)).toEqual(variations[2])
    } finally { random.mockRestore() }
  })
  it.each([1, 2, 4] as const)('gera %i compasso(s), acordes no tempo real e conducoes suaves', bars => {
    for (const key of ['C', 'G'] as const) for (const style of ['pop', 'funk', 'reggaeton', 'lofi'] as const) for (const seed of [0, 1, 2]) {
      const result = progression(key, 100, bars, style, seed)
      expect(result.key).toBe(key)
      expect(result.chords).toHaveLength(bars === 1 ? 2 : bars)
      result.chords.forEach((chord, i) => {
        expect(chord.length).toBe(bars === 1 ? 8 : 16)
        expect(chord.step).toBe(i * chord.length)
        expect(result.chordNotes.slice(i * 3, i * 3 + 3)).toEqual(chord.midis.map(midi => ({ time: chord.step * 0.15, duration: chord.length * 0.15, midi })))
        if (i > 0) chord.midis.forEach((midi, voice) => expect(Math.abs(midi - result.chords[i - 1].midis[voice])).toBeLessThanOrEqual(5))
      })
      for (const note of [...result.chordNotes, ...result.bassNotes]) {
        expect(note.time).toBeGreaterThanOrEqual(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.time + note.duration).toBeLessThanOrEqual(bars * 2.4 + 1e-10)
      }
    }
  })
  it('toca baixo pop na fundamental nos tempos 1 e 3', () => {
    expect(progression('C', 120, 1, 'pop', 0).bassNotes).toEqual([
      { time: 0, duration: 0.5, midi: 36 }, { time: 1, duration: 0.5, midi: 43 },
    ])
    expect(progression('C', 120, 2, 'pop', 0).bassNotes.map(note => note.midi)).toEqual([36, 36, 43, 43])
  })
  it('toca reggaeton na fundamental nos tempos 1 e 2.5', () => {
    expect(progression('C', 120, 1, 'reggaeton', 0).bassNotes).toEqual([
      { time: 0, duration: 0.5, midi: 45 }, { time: 0.75, duration: 0.5, midi: 45 },
    ])
  })
  it('toca lofi com fundamental e quinta mais longas', () => {
    expect(progression('C', 120, 2, 'lofi', 0).bassNotes).toEqual([
      { time: 0, duration: 1, midi: 38 }, { time: 1, duration: 1, midi: 45 },
      { time: 2, duration: 1, midi: 43 }, { time: 3, duration: 1, midi: 38 },
    ])
  })
  it('toca funk sincopado na fundamental e oitava com ritmo escolhido pelo seed', () => {
    const a = progression('C', 120, 1, 'funk', 0).bassNotes
    const b = progression('C', 120, 1, 'funk', 1).bassNotes
    expect(a.map(note => note.time / 0.125)).toEqual([0, 3, 6, 10, 14])
    expect(a.map(note => note.midi)).toEqual([36, 48, 36, 48, 36])
    expect(a.every(note => note.duration === 0.125)).toBe(true)
    expect(b.map(note => note.time)).not.toEqual(a.map(note => note.time))
  })
})
