import { accompany, progression } from './harmony'
import type { Accompaniment, ProgressionStyle } from './harmony'
import { transcribe } from './transcribe'
import type { Note as TranscribedNote } from './transcribe'
import { renderNotes } from './synth'
import type { Note as SynthNote } from './synth'
import { loopDuration, stepDuration } from './timing'
import { INSTRUMENT_OCTAVE } from './types'
import type { GridNote, Instrument, Key } from './types'

/** Preserva passos fracionarios da transcricao, sem nova quantizacao. */
export function stepsToNotes(notes: TranscribedNote[], bpm: number): SynthNote[] {
  const step = stepDuration(bpm)
  return notes.map(note => ({ time: note.step * step, duration: note.length * step, midi: note.midi }))
}

export async function voiceToInstrument(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, key: Key, instrument: Instrument = 'ocarina',
): Promise<{ notes: GridNote[]; audio: Float32Array | null }> {
  const transcribed = await transcribe(samples, sampleRate, bpm, bars, key)
  if (!transcribed.length) return { notes: [], audio: null }
  const pitches = transcribed.map(note => note.midi).sort((a, b) => a - b)
  const middle = pitches.length >> 1
  const median = pitches.length % 2 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2
  // Centro aproximado da oitava; empate favorece a regiao mais grave.
  const center = 12 * (INSTRUMENT_OCTAVE[instrument] + 1) + 6
  const shift = 12 * Math.ceil((center - median) / 12 - 0.5)
  const notes = transcribed.map(note => ({ ...note, midi: note.midi + shift }))
  const duration = loopDuration(bpm, bars)
  const buffer = await renderNotes(stepsToNotes(notes, bpm), duration, sampleRate, instrument)
  const audio = normalizedChannel(buffer, duration, sampleRate, 0.708)
  return { notes, audio }
}

function normalizedChannel(buffer: AudioBuffer, duration: number, sampleRate: number, targetPeak: number): Float32Array {
  const audio = new Float32Array(Math.round(duration * sampleRate))
  audio.set(buffer.getChannelData(0).subarray(0, audio.length))
  let peak = 0
  for (const value of audio) peak = Math.max(peak, Math.abs(value))
  if (peak > 0) {
    const gain = targetPeak / peak
    for (let i = 0; i < audio.length; i++) audio[i] *= gain
  }
  return audio
}

export async function renderAccompaniment(
  acc: Accompaniment, duration: number, sampleRate: number, opts: { chords: Instrument; bass?: Instrument },
): Promise<{ chords: Float32Array; bass: Float32Array }> {
  const render = async (notes: SynthNote[], instrument: Instrument, peak: number) => {
    if (!notes.length) return new Float32Array(Math.round(duration * sampleRate))
    const buffer = await renderNotes(notes, duration, sampleRate, instrument)
    return normalizedChannel(buffer, duration, sampleRate, peak)
  }
  const [chords, bass] = await Promise.all([
    render(acc.chordNotes, opts.chords, 10 ** (-9 / 20)),
    render(acc.bassNotes, opts.bass ?? 'bass', 10 ** (-6 / 20)),
  ])
  return { chords, bass }
}

interface RenderedBand {
  chords: string[]
  chordsAudio: Float32Array
  bassAudio: Float32Array
  chordNotes: GridNote[]
  bassNotes: GridNote[]
}

function notesToGrid(notes: SynthNote[], bpm: number): GridNote[] {
  const step = stepDuration(bpm)
  return notes.map(note => ({ step: note.time / step, length: note.duration / step, midi: note.midi }))
}

export async function completeFromTake(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, chordInstrument: Instrument = 'kalimba',
): Promise<(RenderedBand & { key: Key }) | null> {
  // A transcricao e cromatica; C e apenas o argumento legado, nao o tom detectado.
  const notes = await transcribe(samples, sampleRate, bpm, bars, 'C')
  if (!notes.length) return null
  const acc = accompany(notes, bpm, bars)
  const audio = await renderAccompaniment(acc, loopDuration(bpm, bars), sampleRate, { chords: chordInstrument, bass: 'bass' })
  return { key: acc.key, chords: acc.chords.map(chord => chord.name), chordsAudio: audio.chords, bassAudio: audio.bass, chordNotes: notesToGrid(acc.chordNotes, bpm), bassNotes: notesToGrid(acc.bassNotes, bpm) }
}

/** Sem taxa informada, gera em 48 kHz; o sexto argumento permite usar a taxa do motor. */
export async function bandFromStyle(
  key: Key, bpm: number, bars: 1 | 2 | 4, style: ProgressionStyle, seed: number, sampleRate = 48000,
): Promise<RenderedBand & { chordInstrument: Instrument }> {
  const instruments: readonly Instrument[] = ['kalimba', 'flute', 'ocarina']
  const choice = ((Math.trunc(Number.isFinite(seed) ? seed : 0) % instruments.length) + instruments.length) % instruments.length
  const chordInstrument = instruments[choice]
  const acc = progression(key, bpm, bars, style, seed)
  const audio = await renderAccompaniment(acc, loopDuration(bpm, bars), sampleRate, { chords: chordInstrument, bass: 'bass' })
  return { chords: acc.chords.map(chord => chord.name), chordsAudio: audio.chords, bassAudio: audio.bass, chordNotes: notesToGrid(acc.chordNotes, bpm), bassNotes: notesToGrid(acc.bassNotes, bpm), chordInstrument }
}
