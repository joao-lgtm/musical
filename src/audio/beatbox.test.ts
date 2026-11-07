import { describe, expect, it } from 'vitest'
import { detectDrums } from './beatbox'
import { DRUM_VOICES } from './types'
import type { DrumVoice } from './types'

const SR = 48000
type Hit = { voice: DrumVoice; time: number; gain?: number }
function audio(seconds: number, hits: Hit[], noise = 0, rate = SR) {
  const samples = new Float32Array(Math.round(seconds * rate))
  let seed = 17
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 31 - 1)
  for (let i = 0; i < samples.length; i++) samples[i] = noise * random()
  for (const hit of hits) {
    let lp = 0, slow = 0
    const length = hit.voice === 'hat' ? 0.045 : hit.voice === 'clap' ? 0.04 : 0.22
    for (let i = 0; i < length * rate; i++) {
      const index = Math.round(hit.time * rate) + i
      if (index >= samples.length) break
      const t = i / rate, n = random()
      lp += (1 - Math.exp(-2 * Math.PI * (hit.voice === 'hat' ? 6000 : 2000) / rate)) * (n - lp)
      slow += (1 - Math.exp(-2 * Math.PI * 200 / rate)) * (lp - slow)
      let value: number
      if (hit.voice === 'kick') value = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.055)
      else if (hit.voice === 'hat') value = (n - lp) * Math.exp(-t / 0.009)
      else if (hit.voice === 'clap') {
        const phase = t % 0.01
        value = t < 0.028 && phase < 0.003 ? (lp - slow) * 1.5 : 0
      } else value = ((lp - slow) + 0.25 * Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-t / 0.035)
      samples[index] += value * (hit.gain ?? 0.8)
    }
  }
  return samples
}
function expected(bars: 1 | 2 | 4, entries: [DrumVoice, number][]) {
  const result = DRUM_VOICES.map(() => Array<boolean>(bars * 16).fill(false))
  for (const [voice, step] of entries) result[DRUM_VOICES.indexOf(voice)][step] = true
  return result
}

describe('detectDrums', () => {
  it('returns four empty rows for silence and steady light noise', async () => {
    expect(await detectDrums(new Float32Array(SR * 2), SR, 120, 1)).toEqual(expected(1, []))
    expect(await detectDrums(audio(4, [], 0.004), SR, 120, 2)).toEqual(expected(2, []))
  })
  it.each(['kick', 'snare', 'hat'] as const)('classifies isolated %s at known steps', async voice => {
    const samples = audio(2, [{ voice, time: 0.25 }, { voice, time: 1 }], 0.002)
    expect(await detectDrums(samples, SR, 120, 1)).toEqual(expected(1, [[voice, 2], [voice, 8]]))
  })
  it('extracts an entire bar in voice order', async () => {
    const entries: [DrumVoice, number][] = [['kick', 0], ['hat', 2], ['snare', 4], ['hat', 6], ['kick', 8], ['hat', 10], ['snare', 12], ['hat', 14]]
    const samples = audio(2, entries.map(([voice, step]) => ({ voice, time: step * 0.125 })), 0.003)
    expect(await detectDrums(samples, SR, 120, 1)).toEqual(expected(1, entries))
  })
  it('uses clap only for three clearly separated transients', async () => {
    expect(await detectDrums(audio(2, [{ voice: 'clap', time: 0.5 }, { voice: 'snare', time: 1 }]), SR, 120, 1))
      .toEqual(expected(1, [['clap', 4], ['snare', 8]]))
  })
  it('rounds off-grid onsets, deduplicates steps and ignores audio beyond the loop', async () => {
    const samples = audio(5, [{ voice: 'hat', time: 0.22 }, { voice: 'hat', time: 0.29 }, { voice: 'kick', time: 4.2 }])
    expect(await detectDrums(samples, SR, 60, 1)).toEqual(expected(1, [['hat', 1]]))
  })
  it('supports 44.1 kHz and notes close to the final step', async () => {
    const entries: [DrumVoice, number][] = [['kick', 0], ['snare', 4], ['hat', 15]]
    const samples = audio(2, entries.map(([voice, step]) => ({ voice, time: step * 0.125 })), 0.002, 44100)
    expect(await detectDrums(samples, 44100, 120, 1)).toEqual(expected(1, entries))
  })
  it('processes 16 seconds cooperatively', async () => {
    const entries: [DrumVoice, number][] = Array.from({ length: 64 }, (_, step) => [step % 4 === 0 ? 'kick' : step % 4 === 2 ? 'snare' : 'hat', step])
    const samples = audio(16, entries.map(([voice, step]) => ({ voice, time: step * 0.25 })), 0.003)
    let yielded = false
    setTimeout(() => { yielded = true }, 0)
    const pattern = await detectDrums(samples, SR, 60, 4)
    expect(yielded).toBe(true)
    expect(pattern).toEqual(expected(4, entries))
  })
  it.runIf(import.meta.env.MODE === 'bench')('benchmark: beatbox 16s/48kHz under 300 ms', async () => {
    const entries: [DrumVoice, number][] = Array.from({ length: 64 }, (_, step) => [step % 4 === 0 ? 'kick' : step % 4 === 2 ? 'snare' : 'hat', step])
    const samples = audio(16, entries.map(([voice, step]) => ({ voice, time: step * 0.25 })), 0.003)
    const start = performance.now()
    await detectDrums(samples, SR, 60, 4)
    const elapsed = performance.now() - start
    console.log('beatbox 16s/48kHz:', elapsed.toFixed(1), 'ms')
    expect(elapsed).toBeLessThan(300)
  })
})
