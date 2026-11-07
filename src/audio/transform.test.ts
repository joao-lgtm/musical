import type { Accompaniment } from './harmony'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribe } from './transcribe'
import type { Note } from './transcribe'
import { renderNotes } from './synth'
import { loopDuration, stepDuration } from './timing'
import { renderAccompaniment, stepsToNotes, voiceToInstrument } from './transform'

vi.mock('./transcribe', () => ({ transcribe: vi.fn() }))
vi.mock('./synth', () => ({ renderNotes: vi.fn() }))

beforeEach(() => vi.resetAllMocks())

describe('stepsToNotes com timing real', () => {
  it.each([60, 100, 180])('converte passos e duracoes em segundos a %i BPM sem mutar notas', bpm => {
    const notes: Note[] = [{ step: 0, length: 1, midi: 60 }, { step: 7, length: 3, midi: 67 }]
    const original = structuredClone(notes)
    const converted = stepsToNotes(notes, bpm)
    expect(converted).toEqual([
      { time: 0, duration: stepDuration(bpm), midi: 60 },
      { time: 7 * stepDuration(bpm), duration: 3 * stepDuration(bpm), midi: 67 },
    ])
    expect(converted[1].time).toBeCloseTo(7 * 15 / bpm)
    expect(converted[1].duration).toBeCloseTo(3 * 15 / bpm)
    expect(notes).toEqual(original)
    expect(converted[0]).not.toBe(notes[0])
    expect(transcribe).not.toHaveBeenCalled()
    expect(renderNotes).not.toHaveBeenCalled()
  })

  it('preserva tempos fracionarios da voz', () => {
    expect(stepsToNotes([{ step: 2.48, length: 3.5, midi: 66 }], 120)).toEqual([
      { time: 0.31, duration: 0.4375, midi: 66 },
    ])
  })
  it('retorna vazio para nenhuma nota', () => {
    expect(stepsToNotes([], 120)).toEqual([])
  })
})

function rendered(channel: Float32Array) {
  const getChannelData = vi.fn(() => channel)
  vi.mocked(renderNotes).mockResolvedValue({ getChannelData } as unknown as AudioBuffer)
  return getChannelData
}

describe('voiceToInstrument', () => {
  it('repassa entrada e tom para transcribe e nao renderiza quando nao ha notas', async () => {
    const samples = Float32Array.from([0, 0, 0])
    vi.mocked(transcribe).mockResolvedValue([])
    expect(await voiceToInstrument(samples, 48000, 100, 2, 'F#')).toEqual({ notes: [], audio: null })
    expect(transcribe).toHaveBeenCalledExactlyOnceWith(samples, 48000, 100, 2, 'F#')
    expect(renderNotes).not.toHaveBeenCalled()
  })

  it.each([1, 2, 4] as const)('renderiza %i compasso(s) e extrai somente o canal zero', async bars => {
    const samples = Float32Array.from([0.25, -0.25])
    const notes: Note[] = [{ step: 2, length: 4, midi: 62 }, { step: 10, length: 2, midi: 69 }]
    vi.mocked(transcribe).mockResolvedValue(notes)
    const length = Math.round(loopDuration(100, bars) * 48000)
    const channel = new Float32Array(length)
    channel[0] = 0.5
    channel[length - 1] = -0.5
    const getChannelData = rendered(channel)
    const result = await voiceToInstrument(samples, 48000, 100, bars, 'D')
    expect(transcribe).toHaveBeenCalledExactlyOnceWith(samples, 48000, 100, bars, 'D')
    expect(renderNotes).toHaveBeenCalledExactlyOnceWith([
      { time: 0.3, duration: 0.6, midi: 62 },
      { time: 1.5, duration: 0.3, midi: 69 },
    ], loopDuration(100, bars), 48000, 'ocarina')
    expect(getChannelData).toHaveBeenCalledExactlyOnceWith(0)
    expect(result.notes).toEqual(notes)
    expect(result.audio).toBeInstanceOf(Float32Array)
    expect(result.audio).toHaveLength(length)
    expect(result.audio![0]).toBeCloseTo(0.708)
    expect(result.audio![length - 1]).toBeCloseTo(-0.708)
    expect(samples).toEqual(Float32Array.from([0.25, -0.25]))
  })

  it.each([
    ['bass', -24], ['flute', 12], ['ocarina', 0],
  ] as const)('adapta a melodia para %s somente por oitavas', async (instrument, shift) => {
    const notes: Note[] = [{ step: 0.4, length: 1.5, midi: 60 }, { step: 2, length: 2, midi: 64 }, { step: 5, length: 1, midi: 67 }]
    const original = structuredClone(notes)
    vi.mocked(transcribe).mockResolvedValue(notes)
    rendered(new Float32Array(1))
    const result = await voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C', instrument)
    const shifted = notes.map(note => ({ ...note, midi: note.midi + shift }))
    expect(result.notes).toEqual(shifted)
    expect(renderNotes).toHaveBeenCalledExactlyOnceWith(stepsToNotes(shifted, 120), 2, 48000, instrument)
    expect(notes).toEqual(original)
  })
  it.each([['bass', 36], ['flute', 72], ['ocarina', 60]] as const)('posiciona C4 em %s sem fracionar a altura', async (instrument, midi) => {
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 2, midi: 60 }])
    rendered(new Float32Array(1))
    const result = await voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C', instrument)
    expect(result.notes[0].midi).toBe(midi)
  })
  it('recorta o frame excedente do renderer no comprimento arredondado do loop', async () => {
    const bpm = 137, sampleRate = 44100
    const exact = loopDuration(bpm, 1) * sampleRate
    const length = Math.round(exact)
    expect(Math.ceil(exact)).toBeGreaterThan(length)
    const channel = new Float32Array(Math.ceil(exact)).fill(0.25)
    channel[length] = 1
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 1, midi: 60 }])
    rendered(channel)
    const { audio } = await voiceToInstrument(new Float32Array(1), sampleRate, bpm, 1, 'C')
    expect(audio).toHaveLength(length)
    expect(audio![length - 1]).toBeCloseTo(0.708)
  })

  it('completa com silencio se o renderer fornecer um canal curto', async () => {
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 1, midi: 60 }])
    rendered(Float32Array.from([0.5]))
    const { audio } = await voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C')
    expect(audio).toHaveLength(96000)
    expect(audio![0]).toBeCloseTo(0.708)
    expect(audio![1]).toBe(0)
    expect(audio![95999]).toBe(0)
  })

  it.each([0.01, 2])('normaliza pico %s para -3 dBFS sem alterar proporcoes nem o buffer original', async peak => {
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 1, midi: 66 }])
    const channel = Float32Array.from([peak, -peak / 2])
    rendered(channel)
    const { audio } = await voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C')
    expect(audio![0]).toBeCloseTo(0.708)
    expect(audio![1]).toBeCloseTo(-0.354)
    expect(channel[0]).toBeCloseTo(peak)
  })
  it('mantem silencio sem dividir por zero', async () => {
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 1, midi: 66 }])
    rendered(new Float32Array(1))
    const { audio } = await voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C')
    expect(audio!.every(value => value === 0)).toBe(true)
  })
  it('propaga erros de transcricao sem renderizar', async () => {
    const error = new Error('Transcricao falhou')
    vi.mocked(transcribe).mockRejectedValue(error)
    await expect(voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C')).rejects.toBe(error)
    expect(renderNotes).not.toHaveBeenCalled()
  })

  it('propaga erros do renderer', async () => {
    const error = new Error('Render falhou')
    vi.mocked(transcribe).mockResolvedValue([{ step: 0, length: 1, midi: 60 }])
    vi.mocked(renderNotes).mockRejectedValue(error)
    await expect(voiceToInstrument(new Float32Array(1), 48000, 120, 1, 'C')).rejects.toBe(error)
  })
})

describe('renderAccompaniment', () => {
  function accompaniment(): Accompaniment {
    return {
      key: 'C', chords: [],
      chordNotes: [{ time: 0, duration: 1, midi: 60 }, { time: 0, duration: 1, midi: 64 }],
      bassNotes: [{ time: 0, duration: 0.5, midi: 36 }],
    }
  }
  function buffer(channel: Float32Array) {
    return { getChannelData: vi.fn(() => channel) } as unknown as AudioBuffer
  }
  it('repassa instrumentos e normaliza acordes a -9dBFS e baixo a -6dBFS', async () => {
    const acc = accompaniment(), original = structuredClone(acc)
    const a = Float32Array.from([2, -1, 0]), b = Float32Array.from([0.1, -0.2])
    vi.mocked(renderNotes).mockResolvedValueOnce(buffer(a)).mockResolvedValueOnce(buffer(b))
    const result = await renderAccompaniment(acc, 1, 48000, { chords: 'kalimba' })
    expect(renderNotes).toHaveBeenNthCalledWith(1, acc.chordNotes, 1, 48000, 'kalimba')
    expect(renderNotes).toHaveBeenNthCalledWith(2, acc.bassNotes, 1, 48000, 'bass')
    expect(result.chords).toHaveLength(48000)
    expect(result.bass).toHaveLength(48000)
    expect(result.chords[0]).toBeCloseTo(10 ** (-9 / 20), 6)
    expect(result.chords[1]).toBeCloseTo(-(10 ** (-9 / 20)) / 2, 6)
    expect(result.bass[1]).toBeCloseTo(-(10 ** (-6 / 20)), 6)
    expect(result.bass[0]).toBeCloseTo(10 ** (-6 / 20) / 2, 6)
    expect(result.chords[47999]).toBe(0)
    expect(result.bass[47999]).toBe(0)
    expect(a).toEqual(Float32Array.from([2, -1, 0]))
    expect(b).toEqual(Float32Array.from([0.1, -0.2]))
    expect(acc).toEqual(original)
  })
  it('permite escolher outro instrumento para o baixo e recorta antes de medir pico', async () => {
    const duration = 1.234, sampleRate = 44100, size = Math.round(duration * sampleRate)
    const chord = new Float32Array(size + 1).fill(0.2)
    chord[size] = 10
    vi.mocked(renderNotes).mockResolvedValueOnce(buffer(chord)).mockResolvedValueOnce(buffer(new Float32Array(size)))
    const result = await renderAccompaniment(accompaniment(), duration, sampleRate, { chords: 'ocarina', bass: 'flute' })
    expect(renderNotes).toHaveBeenNthCalledWith(2, accompaniment().bassNotes, duration, sampleRate, 'flute')
    expect(result.chords).toHaveLength(size)
    expect(result.bass).toHaveLength(size)
    expect(result.chords[size - 1]).toBeCloseTo(10 ** (-9 / 20), 6)
    expect(result.bass.every(value => value === 0)).toBe(true)
  })
  it('retorna dois buffers completos de silencio para listas vazias', async () => {
    const acc = { ...accompaniment(), chordNotes: [], bassNotes: [] }
    const result = await renderAccompaniment(acc, 2, 48000, { chords: 'kalimba' })
    for (const audio of [result.chords, result.bass]) {
      expect(audio).toHaveLength(96000)
      expect(audio.every(value => value === 0)).toBe(true)
    }
    expect(result.chords).not.toBe(result.bass)
    expect(renderNotes).not.toHaveBeenCalled()
  })
  it('aceita baixo sem notas junto de acordes renderizados', async () => {
    const acc = { ...accompaniment(), bassNotes: [] }
    vi.mocked(renderNotes).mockResolvedValue(buffer(Float32Array.from([1])))
    const result = await renderAccompaniment(acc, 1, 48000, { chords: 'kalimba' })
    expect(renderNotes).toHaveBeenCalledExactlyOnceWith(acc.chordNotes, 1, 48000, 'kalimba')
    expect(result.chords[0]).toBeCloseTo(10 ** (-9 / 20), 6)
    expect(result.bass).toHaveLength(48000)
    expect(result.bass.every(value => value === 0)).toBe(true)
  })
  it('propaga falhas de renderizacao', async () => {
    const error = new Error('Render falhou')
    vi.mocked(renderNotes).mockRejectedValue(error)
    await expect(renderAccompaniment(accompaniment(), 1, 48000, { chords: 'kalimba' })).rejects.toBe(error)
  })
})
