import { transcribe } from './transcribe'
import type { Note as TranscribedNote } from './transcribe'
import { renderNotes } from './synth'
import type { Note as SynthNote } from './synth'
import { loopDuration, stepDuration } from './timing'
import type { Key } from './types'

export function stepsToNotes(notes: TranscribedNote[], bpm: number): SynthNote[] {
  const step = stepDuration(bpm)
  return notes.map(note => ({ time: note.step * step, duration: note.length * step, midi: note.midi }))
}

export async function voiceToInstrument(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, key: Key,
): Promise<{ notes: TranscribedNote[]; audio: Float32Array | null }> {
  const notes = await transcribe(samples, sampleRate, bpm, bars, key)
  if (!notes.length) return { notes: [], audio: null }
  const duration = loopDuration(bpm, bars)
  const buffer = await renderNotes(stepsToNotes(notes, bpm), duration, sampleRate)
  const audio = new Float32Array(Math.round(duration * sampleRate))
  audio.set(buffer.getChannelData(0).subarray(0, audio.length))
  return { notes, audio }
}
