import type { Key } from './types'
import { hzToMidi } from './scale'

/** step e length podem ser fracionarios; key permanece apenas por compatibilidade. */
export interface Note { step: number; length: number; midi: number }

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

export async function transcribe(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, _key: Key,
): Promise<Note[]> {
  if (!Number.isFinite(sampleRate) || sampleRate < 2000 || !Number.isFinite(bpm) || bpm <= 0) return []
  const stepTime = 15 / bpm
  const duration = Math.min(samples.length / sampleRate, bars * 16 * stepTime)
  const factor = Math.max(1, Math.round(sampleRate / 11025))
  const rate = sampleRate / factor
  const signal = new Float32Array(Math.floor(duration * sampleRate / factor))
  // Dois polos passa-baixa antes da decimacao.
  const alpha = 1 - Math.exp(-2 * Math.PI * Math.min(2000, rate * 0.2) / sampleRate)
  let low = 0, filtered = 0
  for (let i = 0, j = 0; i < signal.length * factor; i++) {
    low += alpha * (samples[i] - low)
    filtered += alpha * (low - filtered)
    if (i % factor === factor - 1) signal[j++] = filtered
  }
  const size = Math.round(rate * 0.023)
  const hop = Math.round(rate * 0.011)
  const minLag = Math.max(2, Math.floor(rate / 1000))
  const maxLag = Math.min(size - 2, Math.ceil(rate / 80))
  const difference = new Float64Array(maxLag + 1)
  const pitches: (number | null)[] = []
  const energy: number[] = []
  for (let start = -Math.floor(size / 2), frame = 0; start < signal.length; start += hop, frame++) {
    let power = 0
    for (let i = Math.max(0, start); i < Math.min(signal.length, start + size); i++) power += signal[i] ** 2
    const rms = Math.sqrt(power / size)
    energy.push(rms)
    let pitch: number | null = null
    if (rms >= 0.008 && start >= 0 && start + size <= signal.length) {
      let sum = 0
      for (let lag = 1; lag <= maxLag; lag++) {
        let d = 0
        for (let i = 0; i < size - maxLag; i++) {
          const delta = signal[start + i] - signal[start + i + lag]
          d += delta * delta
        }
        sum += d
        difference[lag] = sum > 0 ? d * lag / sum : 1
      }
      for (let lag = minLag; lag < maxLag; lag++) {
        if (difference[lag] >= 0.15) continue
        while (lag < maxLag && difference[lag + 1] < difference[lag]) lag++
        const left = difference[lag - 1], mid = difference[lag], right = difference[Math.min(maxLag, lag + 1)]
        const denominator = left - 2 * mid + right
        const offset = denominator === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator)))
        pitch = hzToMidi(rate / (lag + offset))
        break
      }
    }
    pitches.push(pitch)
    if (frame > 0 && frame % 200 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  // Fecha falhas curtas do YIN em transicoes, sem atravessar silencio.
  for (let i = 1; i < pitches.length - 1; i++) {
    if (pitches[i] !== null || pitches[i - 1] === null) continue
    let end = i
    while (end < pitches.length && pitches[end] === null && energy[end] >= 0.008 && end - i < 2) end++
    const before = pitches[i - 1], after = pitches[end]
    if (before !== null && after != null && Math.abs(before - after) < 1) {
      for (let j = i; j < end; j++) pitches[j] = (before + after) / 2
    }
  }
  const smooth = pitches.map((pitch, i) => {
    if (pitch === null) return null
    const nearby: number[] = [pitch]
    for (const direction of [-1, 1]) {
      for (let d = 1; d <= 2; d++) {
        const value = pitches[i + direction * d]
        if (value == null) break
        nearby.push(value)
      }
    }
    return median(nearby)
  })
  const segments: { start: number; end: number; attack: boolean }[] = []
  const frameTime = hop / rate
  const stableFrames = Math.ceil(0.04 / frameTime)
  let start = -1, anchor = 0, beganWithAttack = false
  for (let i = 0; i <= smooth.length; i++) {
    const pitch = smooth[i] ?? null
    const attack = i > 0 && energy[i] > 0.015 && energy[i] > median(energy.slice(Math.max(0, i - 3), i)) * 1.8
    let changed = false
    if (start >= 0 && pitch !== null && i - start >= stableFrames && Math.abs(pitch - anchor) > 0.7) {
      const next = smooth.slice(i, i + stableFrames)
      if (next.length === stableFrames && next.every(value => value !== null)) {
        const values = next as number[]
        const direction = Math.sign(pitch - anchor)
        changed = values.every(value => (value - anchor) * direction > 0.7) &&
          Math.max(...values) - Math.min(...values) < 0.7
      }
    }
    if (start >= 0 && (pitch === null || attack || changed)) {
      segments.push({ start, end: i, attack: beganWithAttack })
      start = -1
    }
    if (pitch !== null && start < 0) {
      start = i
      beganWithAttack = attack
      anchor = median(smooth.slice(i, i + stableFrames).filter((value): value is number => value !== null))
    }
  }
  const pitched = segments.map(segment => {
    const coreStart = segment.start + Math.ceil(0.04 / frameTime)
    const coreEnd = segment.end - Math.ceil((segment.end - segment.start) * 0.2)
    let core = pitches.slice(coreStart, coreEnd).filter((value): value is number => value !== null)
    if (!core.length) core = pitches.slice(segment.start, segment.end).filter((value): value is number => value !== null)
    // MIDI e logaritmico: a mediana em cents preserva vibrato e rejeita portamento nas bordas.
    return { ...segment, midi: Math.round(median(core.map(value => value * 100)) / 100) }
  })
  // Corrige apenas ilhas curtas de oitava entre duas notas concordantes.
  const corrected = pitched.map((note, i) => {
    const before = pitched[i - 1], after = pitched[i + 1]
    if (before && after && (note.end - note.start) * frameTime < 0.18 &&
      Math.abs(before.midi - after.midi) <= 1 && Math.abs(Math.abs(note.midi - before.midi) - 12) <= 1) {
      return { ...note, midi: note.midi + (note.midi > before.midi ? -12 : 12) }
    }
    return note
  })
  const notes: Note[] = []
  let previousEnd = -1
  for (const note of corrected) {
    const onset = note.start * frameTime
    const end = Math.min(duration, note.end * frameTime)
    if (end - onset < stepTime / 2 - frameTime) continue
    const nearest = Math.round(onset / stepTime)
    const step = Math.abs(nearest * stepTime - onset) <= stepTime * 0.35 ? nearest : onset / stepTime
    if (step >= bars * 16) continue
    const length = Math.min(bars * 16 - step, Math.max(0.5, Math.round((end / stepTime - step) * 2) / 2))
    const previous = notes.at(-1)
    if (previous && previous.midi === note.midi && note.start - previousEnd <= 2 && energy.slice(previousEnd, note.start).every(value => value >= 0.008) && !note.attack) {
      previous.length = step + length - previous.step
    } else notes.push({ step, length, midi: note.midi })
    previousEnd = note.end
  }
  return notes
}
