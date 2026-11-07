import type { Key } from './types'
import { hzToMidi, quantizeToScale } from './scale'

export interface Note { step: number; length: number; midi: number }

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

export async function transcribe(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4, key: Key,
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
  const notes: Note[] = []
  let start = -1
  let values: number[] = []
  let previousEnd = -1
  function finish(end: number, attack: boolean) {
    if (start < 0) return
    const onset = start * hop / rate
    const offset = Math.min(duration, end * hop / rate)
    const step = Math.max(0, Math.round(onset / stepTime))
    const endStep = Math.min(bars * 16, Math.round(offset / stepTime))
    if (offset - onset >= stepTime - hop / rate && endStep > step && step < bars * 16) {
      const midi = quantizeToScale(median(values), key)
      const previous = notes.at(-1)
      if (!attack && previous && previous.midi === midi && previousEnd === start && previous.step + previous.length === step) {
        previous.length = endStep - previous.step
      } else notes.push({ step, length: endStep - step, midi })
    }
    previousEnd = end
    start = -1
    values = []
  }
  let beganWithAttack = false
  for (let i = 0; i <= smooth.length; i++) {
    const pitch = smooth[i] ?? null
    const attack = i > 0 && energy[i] > 0.015 && energy[i] > energy[i - 1] * 1.8
    const changed = pitch !== null && values.length > 0 && Math.abs(pitch - values[Math.floor(values.length / 2)]) >= 1
    if (pitch === null || attack || changed) finish(i, beganWithAttack)
    if (pitch !== null) {
      if (start < 0) { start = i; beganWithAttack = attack }
      values.push(pitch)
    }
  }
  return notes
}
