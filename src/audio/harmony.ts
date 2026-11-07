import type { Note as MelodyNote } from './transcribe'
import type { Note as SynthNote } from './synth'
import { stepDuration } from './timing'
import { KEYS, STEPS_PER_BAR } from './types'
import type { Key } from './types'

export interface Chord { step: number; length: number; name: string; midis: number[] }
export interface Accompaniment { key: Key; chords: Chord[]; chordNotes: SynthNote[]; bassNotes: SynthNote[] }

const PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const ACCIDENTALS = [0, 5, 2, 3, 4, 1, 6, 1, 4, 3, 2, 5]
const DEGREES = [0, 2, 4, 5, 7, 9]
const MINOR = [false, true, true, false, false, true]
const PROGRESSION = [0, 4, 5, 3]
const pc = (midi: number) => ((Math.round(midi) % 12) + 12) % 12

function detectKey(notes: MelodyNote[]): number {
  const histogram = Array<number>(12).fill(0)
  for (const note of notes) histogram[pc(note.midi)] += note.length
  const mean = histogram.reduce((sum, weight) => sum + weight, 0) / 12
  const profileMean = PROFILE.reduce((sum, weight) => sum + weight, 0) / 12
  let best = 0, bestScore = -Infinity
  for (let key = 0; key < 12; key++) {
    let dot = 0, norm = 0, profileNorm = 0
    for (let pitch = 0; pitch < 12; pitch++) {
      const a = histogram[pitch] - mean
      const b = PROFILE[(pitch - key + 12) % 12] - profileMean
      dot += a * b; norm += a * a; profileNorm += b * b
    }
    const score = norm > 0 ? dot / Math.sqrt(norm * profileNorm) : 0
    if (score > bestScore + 1e-10 || (Math.abs(score - bestScore) <= 1e-10 && ACCIDENTALS[key] < ACCIDENTALS[best])) {
      best = key; bestScore = score
    }
  }
  return best
}

function voicing(pitches: number[], previous: number[]): number[] {
  let best: number[] = [], cost = Infinity
  for (let bottom = 52; bottom <= 72; bottom++) {
    if (!pitches.includes(pc(bottom))) continue
    const candidate = pitches.map(pitch => bottom + (pitch - pc(bottom) + 12) % 12).sort((a, b) => a - b)
    if (candidate[2] > 79) continue
    const movement = candidate.reduce((sum, midi, i) => sum + Math.abs(midi - previous[i]), 0)
    if (movement < cost) { best = candidate; cost = movement }
  }
  return best
}

export function accompany(notes: MelodyNote[], bpm: number, bars: 1 | 2 | 4): Accompaniment {
  const total = bars * STEPS_PER_BAR
  const melody = notes.filter(note => Number.isFinite(note.midi) && Number.isFinite(note.step) &&
    Number.isFinite(note.length) && note.length > 0 && note.step < total && note.step + note.length > 0)
    .map(note => ({ ...note, step: Math.max(0, note.step), length: Math.min(total, note.step + note.length) - Math.max(0, note.step) }))
  const key = detectKey(melody)
  const result: Accompaniment = { key: KEYS[key], chords: [], chordNotes: [], bassNotes: [] }
  if (!Number.isFinite(bpm) || bpm <= 0) return result
  const seconds = stepDuration(bpm)
  const length = bars === 1 ? 8 : STEPS_PER_BAR
  const candidates = DEGREES.map((degree, i) => {
    const root = (key + degree) % 12
    return { root, pitches: [root, (root + (MINOR[i] ? 3 : 4)) % 12, (root + 7) % 12], name: KEYS[root] + (MINOR[i] ? 'm' : '') }
  })
  let previousChord = 0, previousVoices = [60, 64, 67]
  for (let step = 0; step < total; step += length) {
    const active = melody.map(note => ({
      pitch: pc(note.midi),
      weight: Math.max(0, Math.min(step + length, note.step + note.length) - Math.max(step, note.step)) *
        (note.step <= step && note.step + note.length > step ? 1.75 : 1),
    })).filter(note => note.weight > 0)
    let chosen = previousChord, best = -Infinity
    const weight = active.reduce((sum, note) => sum + note.weight, 0)
    if (active.length) candidates.forEach((candidate, i) => {
      let score = 0
      for (const note of active) {
        if (candidate.pitches.includes(note.pitch)) score += note.weight
        if (candidate.pitches.some(pitch => (pitch - note.pitch + 12) % 12 === 1 || (note.pitch - pitch + 12) % 12 === 1)) score -= note.weight * 0.45
      }
      if (step === 0 && i === 0) score += weight * 0.08
      const previousIndex = PROGRESSION.indexOf(previousChord)
      if (step > 0 && previousIndex >= 0 && i === PROGRESSION[(previousIndex + 1) % PROGRESSION.length]) score += weight * 0.05
      if (score > best + 1e-10) { chosen = i; best = score }
    })
    const candidate = candidates[chosen]
    const midis = voicing(candidate.pitches, previousVoices)
    result.chords.push({ step, length, name: candidate.name, midis })
    for (const midi of midis) result.chordNotes.push({ time: step * seconds, duration: length * seconds, midi })
    previousChord = chosen
    previousVoices = midis
  }
  for (let step = 0; step < total; step += 8) {
    const chord = result.chords.find(chord => step >= chord.step && step < chord.step + chord.length)!
    const root = candidates.find(candidate => candidate.name === chord.name)!.root
    const fifth = step % STEPS_PER_BAR === 8
    result.bassNotes.push({ time: step * seconds, duration: 4 * seconds, midi: 36 + (root + (fifth ? 7 : 0)) % 12 })
  }
  return result
}
