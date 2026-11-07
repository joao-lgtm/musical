import { afterEach, describe, expect, it, vi } from 'vitest'
import { noteWindow, renderNotes, startVoice } from './synth'

describe('noteWindow', () => {
  it('preserva inicio e duracao com cauda de 60ms', () => {
    const window = noteWindow({ time: 0.2, duration: 0.5, midi: 60 }, 2)!
    expect(window.start).toBe(0.2)
    expect(window.releaseAt).toBeCloseTo(0.7)
    expect(window.end).toBeCloseTo(0.76)
    expect(window.release).toBe(0.06)
  })
  it('antecipa release de nota que atravessa o fim, sem wrap', () => {
    expect(noteWindow({ time: 1, duration: 3, midi: 60 }, 2)).toEqual({ start: 1, releaseAt: 1.94, release: 0.06, end: 2 })
  })
  it('encurta o release para notas junto da borda', () => {
    const window = noteWindow({ time: 1.99, duration: 1, midi: 60 }, 2)!
    expect(window.releaseAt).toBeCloseTo(1.995)
    expect(window.release).toBeCloseTo(0.005)
    expect(window.end).toBe(2)
  })
  it.each([0, 0.001, 0.02])('toque de %ss ganha 90ms antes do release', (duration) => {
    const window = noteWindow({ time: 0.2, duration, midi: 60 }, 2)!
    expect(window.releaseAt - window.start).toBeCloseTo(0.09)
    expect(window.end - window.start).toBeCloseTo(0.15)
  })
  it('ignora notas negativas, fora do loop ou invalidas', () => {
    expect(noteWindow({ time: 2, duration: 1, midi: 60 }, 2)).toBeNull()
    expect(noteWindow({ time: 0, duration: -1, midi: 60 }, 2)).toBeNull()
    expect(noteWindow({ time: 0, duration: 1, midi: NaN }, 2)).toBeNull()
  })
})


function context() {
  const nodes: { disconnect: ReturnType<typeof vi.fn> }[] = []
  function parameter() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }
  }
  function node() {
    const result = {
      type: '', buffer: null as AudioBuffer | null, loop: false,
      gain: parameter(), frequency: parameter(), detune: parameter(), Q: parameter(),
      connect: vi.fn((dest: unknown) => dest), disconnect: vi.fn(),
      start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null,
    }
    nodes.push(result)
    return result
  }
  const samples = new Float32Array(100)
  const ctx = {
    currentTime: 0, sampleRate: 100, destination: node(),
    createOscillator: vi.fn(node), createGain: vi.fn(node), createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node),
    createBuffer: vi.fn(() => ({ getChannelData: () => samples })),
    startRendering: vi.fn().mockResolvedValue({ rendered: true }),
  }
  return { ctx, nodes }
}

describe('voz Web Audio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('usa harmonia suave, sopro baixo e vibrato atrasado', () => {
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 1)
    const [fundamental, harmonic, vibrato] = ctx.createOscillator.mock.results.map((result) => result.value)
    expect(fundamental.frequency.value).toBe(440)
    expect(harmonic.frequency.value).toBe(880)
    expect(vibrato.frequency.value).toBe(5)
    const [overtone, air, depth, envelope] = ctx.createGain.mock.results.map((result) => result.value)
    expect(overtone.gain.value).toBe(0.08)
    expect(air.gain.value).toBe(0.035)
    expect(depth.gain.setValueAtTime).toHaveBeenCalledWith(0, 1.15)
    expect(depth.gain.linearRampToValueAtTime).toHaveBeenCalledWith(9, 1.25)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.24, 1.025)
    expect(envelope.connect).toHaveBeenCalledWith(ctx.destination)
  })

  it('release durante ataque e idempotente; todos os nos desconectam ao terminar', () => {
    const { ctx, nodes } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0)
    voice.stop(0.01, 0.06)
    voice.stop(0.02)
    const envelope = ctx.createGain.mock.results[3].value
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.24 * 0.01 / 0.025, 0.01)
    expect(envelope.gain.setValueAtTime).toHaveBeenCalledTimes(1)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.01 + 0.06)
    const sources = [...ctx.createOscillator.mock.results, ...ctx.createBufferSource.mock.results].map((result) => result.value)
    for (const source of sources) {
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.stop).toHaveBeenCalledWith(0.01 + 0.06)
      source.onended!()
    }
    for (const node of nodes.slice(1)) expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it('soltar a voz no mesmo frame mantem 90ms antes do release', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0)
    voice.stop(0)
    const envelope = ctx.createGain.mock.results[3].value
    expect(envelope.gain.setValueAtTime).toHaveBeenLastCalledWith(0.24, 0.09)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.09 + 0.06)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop).toHaveBeenCalledWith(0.09 + 0.06)
  })

  it('renderNotes inclui a nota instantanea com sustentacao minima', async () => {
    const { ctx } = context()
    vi.stubGlobal('OfflineAudioContext', vi.fn(function () { return ctx }))
    await renderNotes([{ time: 0.2, duration: 0, midi: 60 }], 2, 48000)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(3)
    const envelope = ctx.createGain.mock.results[3].value
    expect(envelope.gain.setValueAtTime.mock.calls.at(-1)![1]).toBeCloseTo(0.29)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop.mock.calls[0][0]).toBeCloseTo(0.35)
  })

  it('renderiza mono com tamanho exato e release dentro do loop', async () => {
    const { ctx } = context()
    const Offline = vi.fn(function () { return ctx })
    vi.stubGlobal('OfflineAudioContext', Offline)
    const buffer = await renderNotes([{ time: 1, duration: 3, midi: 60 }, { time: 2, duration: 1, midi: 62 }], 2, 48000)
    expect(Offline).toHaveBeenCalledWith(1, 96000, 48000)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(3)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop).toHaveBeenCalledWith(2)
    expect(ctx.startRendering).toHaveBeenCalledTimes(1)
    expect(buffer).toEqual({ rendered: true })
  })
})
