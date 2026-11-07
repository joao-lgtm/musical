import { describe, expect, it, vi } from 'vitest'
import { playDrum } from './drums'
import { DRUM_VOICES } from './types'

function context() {
  const gains: ReturnType<typeof parameter>[] = []
  function parameter() { return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
  function node() { return { frequency: parameter(), Q: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() } }
  const ctx = {
    sampleRate: 100,
    createGain: vi.fn(() => { const gain = parameter(); gains.push(gain); return { ...node(), gain } }),
    createOscillator: vi.fn(node), createBufferSource: vi.fn(node), createBiquadFilter: vi.fn(node),
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(100) })),
  }
  return { ctx: ctx as unknown as BaseAudioContext, gains }
}
const peaks = { kick: [1], snare: [0.7, 0.5], hat: [0.4], clap: [0.8, 0.8, 0.8, 0.6] }

describe('playDrum velocity', () => {
  it.each(DRUM_VOICES)('%s preserva envelopes originais com velocity omitida ou 1', voice => {
    const a = context(), b = context(), dest = {} as AudioNode
    playDrum(a.ctx, dest, voice, 2)
    playDrum(b.ctx, dest, voice, 2, 1)
    expect(a.gains).toHaveLength(peaks[voice].length)
    a.gains.forEach((gain, i) => {
      expect(gain.setValueAtTime).toHaveBeenCalledWith(0.0001, voice === 'clap' ? 2 + i * 0.01 : 2)
      expect(gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(peaks[voice][i])
      expect(gain.exponentialRampToValueAtTime.mock.calls).toEqual(b.gains[i].exponentialRampToValueAtTime.mock.calls)
      expect(gain.setValueAtTime.mock.calls).toEqual(b.gains[i].setValueAtTime.mock.calls)
    })
  })
  it.each(DRUM_VOICES)('%s escala todos os picos sem alterar os tempos', voice => {
    const full = context(), half = context(), dest = {} as AudioNode
    playDrum(full.ctx, dest, voice, 2, 1)
    playDrum(half.ctx, dest, voice, 2, 0.5)
    half.gains.forEach((gain, i) => {
      expect(gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(peaks[voice][i] * 0.5)
      expect(gain.exponentialRampToValueAtTime.mock.calls.map(call => call[1]))
        .toEqual(full.gains[i].exponentialRampToValueAtTime.mock.calls.map(call => call[1]))
    })
  })
  it('limita velocity e nao agenda fontes para zero', () => {
    for (const velocity of [0, -1, NaN]) {
      const { ctx, gains } = context()
      playDrum(ctx, {} as AudioNode, 'snare', 0, velocity)
      expect(gains).toHaveLength(0)
    }
    const { ctx, gains } = context()
    playDrum(ctx, {} as AudioNode, 'kick', 0, 2)
    expect(gains[0].exponentialRampToValueAtTime.mock.calls[0][0]).toBe(1)
  })
})
