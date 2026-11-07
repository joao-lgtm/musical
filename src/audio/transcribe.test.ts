import { describe, expect, it } from 'vitest'
import { transcribe } from './transcribe'
import { midiToHz } from './scale'

const SR = 48000
function signal(seconds: number, tones: { start: number; end: number; midi: number; amplitude?: number }[], noise = 0) {
  const samples = new Float32Array(Math.round(seconds * SR))
  let seed = 42
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    samples[i] = (seed / 2 ** 31 - 1) * noise
  }
  for (const tone of tones) {
    const frequency = midiToHz(tone.midi)
    for (let i = Math.round(tone.start * SR); i < Math.min(samples.length, Math.round(tone.end * SR)); i++) {
      samples[i] += (tone.amplitude ?? 0.4) * Math.sin(2 * Math.PI * frequency * i / SR)
    }
  }
  return samples
}

describe('transcribe', () => {
  it('returns no notes for silence or unvoiced noise', async () => {
    expect(await transcribe(new Float32Array(SR * 2), SR, 120, 1, 'C')).toEqual([])
    expect(await transcribe(signal(2, [], 0.1), SR, 120, 1, 'C')).toEqual([])
  })
  it('finds noisy pitches at known steps with silence between them', async () => {
    const audio = signal(2, [
      { start: 0.25, end: 0.75, midi: 60 },
      { start: 1, end: 1.5, midi: 67 },
    ], 0.015)
    expect(await transcribe(audio, SR, 120, 1, 'C')).toEqual([
      { step: 2, length: 4, midi: 60 }, { step: 8, length: 4, midi: 67 },
    ])
  })
  it('corrects a brief spurious octave jump', async () => {
    const audio = signal(2, [
      { start: 0.25, end: 0.6, midi: 60 },
      { start: 0.6, end: 0.611, midi: 72 },
      { start: 0.611, end: 1.25, midi: 60 },
    ])
    expect(await transcribe(audio, SR, 120, 1, 'C')).toEqual([{ step: 2, length: 8, midi: 60 }])
  })
  it('segments legato pitches and quantizes to the selected key', async () => {
    const audio = signal(2, [{ start: 0.25, end: 0.75, midi: 61.2 }, { start: 0.75, end: 1.25, midi: 68 }])
    expect(await transcribe(audio, SR, 120, 1, 'D')).toEqual([
      { step: 2, length: 4, midi: 62 }, { step: 6, length: 4, midi: 69 },
    ])
  })
  it('preserves repeated attacks and discards substep notes', async () => {
    const audio = signal(2, [
      { start: 0.25, end: 0.5, midi: 60, amplitude: 0.15 },
      { start: 0.5, end: 0.75, midi: 60, amplitude: 0.5 },
      { start: 1, end: 1.04, midi: 67 },
    ])
    expect(await transcribe(audio, SR, 120, 1, 'C')).toEqual([
      { step: 2, length: 2, midi: 60 }, { step: 4, length: 2, midi: 60 },
    ])
  })
  it('covers low and high pitches and clips notes at loop end', async () => {
    const audio = signal(3, [{ start: 0, end: 0.5, midi: 40 }, { start: 1.5, end: 3, midi: 83 }])
    expect(await transcribe(audio, SR, 120, 1, 'C')).toEqual([
      { step: 0, length: 4, midi: 40 }, { step: 12, length: 4, midi: 84 },
    ])
  })
  it('processes a 16 second loop cooperatively', async () => {
    const audio = signal(16, [{ start: 0, end: 16, midi: 60 }], 0.01)
    let yielded = false
    setTimeout(() => { yielded = true }, 0)
    const notes = await transcribe(audio, SR, 60, 4, 'C')
    expect(yielded).toBe(true)
    expect(notes).toEqual([{ step: 0, length: 64, midi: 60 }])
  })
  it.runIf(import.meta.env.MODE === 'bench')('benchmark: transcribe 16s/48kHz under 300 ms', async () => {
    const audio = signal(16, [{ start: 0, end: 16, midi: 60 }], 0.01)
    const start = performance.now()
    await transcribe(audio, SR, 60, 4, 'C')
    const elapsed = performance.now() - start
    console.log('transcribe 16s/48kHz:', elapsed.toFixed(1), 'ms')
    expect(elapsed).toBeLessThan(300)
  })
})
