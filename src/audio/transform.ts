import { transcribe } from './transcribe'
import type { Note as TranscribedNote } from './transcribe'
import { renderNotes } from './synth'
import type { Note as SynthNote } from './synth'
import { loopDuration, stepDuration } from './timing'
import { INSTRUMENT_OCTAVE } from './types'
import type { Instrument, Key } from './types'

/** Preserva passos fracionarios da transcricao, sem nova quantizacao. */
export function stepsToNotes(notes: TranscribedNote[], bpm: number): SynthNote[] {
  const step = stepDuration(bpm)
  return notes.map(note => ({ time: note.step * step, duration: note.length * step, midi: note.midi }))
}

export async function voiceToInstrument(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, key: Key, instrument: Instrument = 'ocarina',
): Promise<{ notes: TranscribedNote[]; audio: Float32Array | null }> {
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
  const audio = new Float32Array(Math.round(duration * sampleRate))
  audio.set(buffer.getChannelData(0).subarray(0, audio.length))
  let peak = 0
  for (const value of audio) peak = Math.max(peak, Math.abs(value))
  if (peak > 0) {
    const gain = 0.708 / peak
    for (let i = 0; i < audio.length; i++) audio[i] *= gain
  }
  return { notes, audio }
}
