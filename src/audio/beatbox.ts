import { DRUM_VOICES, STEPS_PER_BAR } from './types'
import type { DrumVoice } from './types'

function biquad(rate: number, frequency: number, mode: 'low' | 'band' | 'high') {
  const w = 2 * Math.PI * Math.min(frequency, rate * 0.45) / rate
  const c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2
  const a0 = 1 + alpha, a1 = -2 * c / a0, a2 = (1 - alpha) / a0
  const b0 = (mode === 'low' ? (1 - c) / 2 : mode === 'high' ? (1 + c) / 2 : alpha) / a0
  const b1 = (mode === 'low' ? 1 - c : mode === 'high' ? -1 - c : 0) / a0
  const b2 = mode === 'band' ? -b0 : b0
  let z1 = 0, z2 = 0
  return (x: number) => {
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }
}

function median(values: number[]) {
  values.sort((a, b) => a - b)
  return values.length ? values[values.length >> 1] : 0
}

export async function detectDrums(
  samples: Float32Array, sampleRate: number, bpm: number, bars: 1 | 2 | 4,
): Promise<boolean[][]> {
  const steps = bars * STEPS_PER_BAR
  const pattern = DRUM_VOICES.map(() => Array<boolean>(steps).fill(false))
  if (!Number.isFinite(sampleRate) || sampleRate < 2000 || !Number.isFinite(bpm) || bpm <= 0) return pattern
  const stepTime = 15 / bpm
  const count = Math.min(samples.length, Math.floor(steps * stepTime * sampleRate))
  // Preserva a banda acima de 5 kHz para distinguir chimbal.
  const factor = Math.max(1, Math.floor(sampleRate / 22050))
  const rate = sampleRate / factor
  const hop = Math.max(1, Math.round(rate * 0.005))
  const signal = new Float32Array(Math.floor(count / factor))
  const lowpass = biquad(sampleRate, Math.min(9000, rate * 0.4), 'low')
  const low = biquad(rate, 150, 'low')
  const mid = biquad(rate, 700, 'band')
  const high = biquad(rate, 5000, 'high')
  const bands: number[][] = [[], [], []]
  const flux: number[] = []
  const level: number[] = []
  let input = 0
  for (let start = 0, frame = 0; start < signal.length; start += hop, frame++) {
    const energy = [0, 0, 0]
    const end = Math.min(signal.length, start + hop)
    for (let i = start; i < end; i++) {
      let x = 0
      for (let d = 0; d < factor; d++) x = lowpass(samples[input++])
      signal[i] = x
      const a = low(x), b = mid(x), c = high(x)
      energy[0] += a * a
      energy[1] += b * b
      energy[2] += c * c
    }
    let total = 0
    for (let band = 0; band < 3; band++) {
      const rms = Math.sqrt(energy[band] / (end - start))
      total += rms
      bands[band].push(rms)
    }
    const smoothed = (total + (level.at(-1) ?? total) * 2) / 3
    flux.push(Math.max(0, smoothed - (level.at(-1) ?? 0)))
    level.push(smoothed)
    if (frame > 0 && frame % 200 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const frameTime = hop / rate
  const window = Math.max(1, Math.round(0.04 / frameTime))
  let lastOnset = -Infinity
  for (let frame = 0; frame < flux.length; frame++) {
    const baseline = median(flux.slice(Math.max(0, frame - 30), frame))
    const noise = median(level.slice(Math.max(0, frame - 30), frame))
    if (flux[frame] <= baseline * 3 + Math.max(0.003, noise * 0.15) || level[frame] <= 0.012) continue
    const time = frame * frameTime
    if (time - lastOnset < 0.06 - 1e-6) continue
    lastOnset = time
    const energy = bands.map(band => {
      let sum = 0
      for (let i = frame; i < Math.min(band.length, frame + window); i++) sum += band[i] ** 2
      return sum
    })
    let voice: DrumVoice = 'snare'
    if (energy[0] > energy[1] * 1.4 && energy[0] > energy[2] * 2) voice = 'kick'
    else if (energy[2] > energy[1] * 1.25 && energy[2] > energy[0] * 2) {
      const tail = bands[2][frame + window - 1] ?? 0
      if (tail < Math.sqrt(energy[2] / window) * 0.5) voice = 'hat'
    }
    if (voice === 'snare') {
      // Clap exige tres rajadas separadas por vales profundos em 30 ms.
      const micro = Math.max(1, Math.round(rate * 0.002))
      const envelope: number[] = []
      const start = Math.max(0, (frame - 1) * hop)
      for (let i = start; i < Math.min(signal.length, start + rate * 0.034); i += micro) {
        let sum = 0
        const end = Math.min(signal.length, i + micro)
        for (let j = i; j < end; j++) sum += signal[j] ** 2
        envelope.push(Math.sqrt(sum / (end - i)))
      }
      const peak = Math.max(...envelope)
      let bursts = 0, armed = true, last = -10
      for (let i = 0; i < envelope.length; i++) {
        if (envelope[i] < peak * 0.25) armed = true
        if (armed && envelope[i] > peak * 0.6 && i - last >= 2) {
          bursts++; armed = false; last = i
        }
      }
      if (bursts >= 3) voice = 'clap'
    }
    const step = Math.min(steps - 1, Math.max(0, Math.round(time / stepTime)))
    pattern[DRUM_VOICES.indexOf(voice)][step] = true
  }
  return pattern
}
