import { describe, expect, it, vi } from 'vitest'
import { KITS, playKitVoice } from './kits'
import type { KitId } from './kits'
import { playDrum } from './drums'
import { DRUM_VOICES } from './types'

function context() {
  function param() { return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
  const nodes: ReturnType<typeof makeNode>[] = []
  function makeNode(kind: string) {
    const result = { kind, type: '', buffer: null as AudioBuffer | null, curve: null as Float32Array | null,
      gain: param(), frequency: param(), Q: param(),
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
    return result
  }
  function node(kind: string) {
    const result = makeNode(kind)
    nodes.push(result)
    return result
  }
  const dest = {} as AudioNode
  const ctx = {
    sampleRate: 100,
    createGain: vi.fn(() => node('gain')), createOscillator: vi.fn(() => node('oscillator')),
    createBufferSource: vi.fn(() => node('noise')), createBiquadFilter: vi.fn(() => node('filter')),
    createWaveShaper: vi.fn(() => node('shaper')),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
  }
  return { ctx: ctx as unknown as BaseAudioContext, nodes, dest }
}
function signature(nodes: ReturnType<typeof context>['nodes']) {
  return nodes.map(node => ({ kind: node.kind, type: node.type,
    gain: node.gain.exponentialRampToValueAtTime.mock.calls, initial: node.gain.setValueAtTime.mock.calls,
    frequency: node.frequency.setValueAtTime.mock.calls, sweep: node.frequency.exponentialRampToValueAtTime.mock.calls,
    filter: [node.frequency.value, node.Q.value], start: node.start.mock.calls, stop: node.stop.mock.calls,
  }))
}

describe('kits', () => {
  it.each(['acoustic', '808', 'lofi'] as const)('%s tem oito slots que agendam e limpam todos os nos', kit => {
    expect(KITS[kit].slots).toHaveLength(8)
    for (let slot = 0; slot < 8; slot++) {
      const { ctx, nodes, dest } = context()
      playKitVoice(ctx, dest, kit, slot, 2)
      const sources = nodes.filter(node => node.kind === 'oscillator' || node.kind === 'noise')
      expect(sources.length).toBeGreaterThan(0)
      for (const source of sources) {
        expect(source.start).toHaveBeenCalledOnce()
        expect(source.start.mock.calls[0][0]).toBeGreaterThanOrEqual(2)
        expect(source.stop.mock.calls[0][0]).toBeGreaterThan(source.start.mock.calls[0][0])
        expect(source.onended).toBeTypeOf('function')
        source.onended!()
      }
      nodes.forEach(node => expect(node.disconnect).toHaveBeenCalledOnce())
    }
  })
  it.each(DRUM_VOICES)('acustico %s equivale ao playDrum, inclusive com velocity', voice => {
    for (const velocity of [1, 0.5]) {
      const a = context(), b = context()
      playDrum(a.ctx, a.dest, voice, 2, velocity)
      playKitVoice(b.ctx, b.dest, 'acoustic', DRUM_VOICES.indexOf(voice), 2, velocity)
      expect(signature(a.nodes)).toEqual(signature(b.nodes))
    }
  })
  it.each(['acoustic', '808', 'lofi'] as const)('%s escala velocity sem alterar tempos', kit => {
    for (let slot = 0; slot < 8; slot++) {
      const a = context(), b = context()
      playKitVoice(a.ctx, a.dest, kit, slot, 1, 1)
      playKitVoice(b.ctx, b.dest, kit, slot, 1, 0.5)
      const full = a.nodes.filter(node => node.kind === 'gain')
      const half = b.nodes.filter(node => node.kind === 'gain')
      full.forEach((node, i) => {
        expect(half[i].gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(node.gain.exponentialRampToValueAtTime.mock.calls[0][0] / 2)
        expect(half[i].gain.exponentialRampToValueAtTime.mock.calls[0][1]).toBe(node.gain.exponentialRampToValueAtTime.mock.calls[0][1])
      })
    }
  })
  it('velocity zero e slots invalidos nao criam nos', () => {
    for (const kit of Object.keys(KITS) as KitId[]) for (let slot = 0; slot < 8; slot++) {
      const { ctx, dest, nodes } = context()
      playKitVoice(ctx, dest, kit, slot, 0, 0)
      expect(nodes).toHaveLength(0)
    }
    for (const slot of [-1, 8, 0.5, NaN]) {
      const { ctx, dest, nodes } = context()
      playKitVoice(ctx, dest, 'acoustic', slot, 0)
      expect(nodes).toHaveLength(0)
    }
  })
  it('lofi satura levemente e filtra a 5kHz em cada fonte', () => {
    for (let slot = 0; slot < 8; slot++) {
      const { ctx, nodes, dest } = context()
      playKitVoice(ctx, dest, 'lofi', slot, 0)
      const sources = nodes.filter(node => node.kind === 'noise' || node.kind === 'oscillator')
      expect(nodes.filter(node => node.kind === 'shaper')).toHaveLength(sources.length)
      expect(nodes.filter(node => node.kind === 'filter' && node.type === 'lowpass' && node.frequency.value === 5000)).toHaveLength(sources.length)
      nodes.filter(node => node.kind === 'shaper').forEach(node => {
        expect(node.curve).toBeInstanceOf(Float32Array)
        expect(Math.max(...node.curve!)).toBeLessThanOrEqual(1)
      })
    }
  })
  it('agenda as caudas longas e a cowbell de duas quadradas', () => {
    const cymbal = context(), openHat = context(), kick = context(), bell = context()
    playKitVoice(cymbal.ctx, cymbal.dest, 'acoustic', 6, 1)
    playKitVoice(openHat.ctx, openHat.dest, 'acoustic', 4, 1)
    playKitVoice(kick.ctx, kick.dest, '808', 0, 1)
    expect(cymbal.nodes[0].stop).toHaveBeenCalledWith(2.21)
    expect(openHat.nodes[0].stop).toHaveBeenCalledWith(1.36)
    expect(kick.nodes[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(42, 1.12)
    expect(kick.nodes[0].stop).toHaveBeenCalledWith(2.21)
    playKitVoice(bell.ctx, bell.dest, '808', 6, 1)
    const sources = bell.nodes.filter(node => node.kind === 'oscillator')
    expect(sources.map(node => node.type)).toEqual(['square', 'square'])
    expect(sources.map(node => node.frequency.setValueAtTime.mock.calls[0][0])).toEqual([540, 800])
  })
})
