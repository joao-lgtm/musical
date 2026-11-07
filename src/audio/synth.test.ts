import { afterEach, describe, expect, it, vi } from 'vitest'
import { noteWindow, renderNotes, startVoice } from './synth'

describe('noteWindow', () => {
  it('preserva inicio e duracao com cauda de 90ms', () => {
    const window = noteWindow({ time: 0.2, duration: 0.5, midi: 60 }, 2)!
    expect(window.start).toBe(0.2)
    expect(window.releaseAt).toBeCloseTo(0.7)
    expect(window.end).toBeCloseTo(0.79)
    expect(window.release).toBe(0.09)
  })
  it('antecipa release de nota que atravessa o fim, sem wrap', () => {
    expect(noteWindow({ time: 1, duration: 3, midi: 60 }, 2)).toEqual({ start: 1, releaseAt: 1.91, release: 0.09, end: 2 })
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
    expect(window.end - window.start).toBeCloseTo(0.18)
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
    currentTime: 0, sampleRate: 48000, destination: node(),
    createOscillator: vi.fn(node), createGain: vi.fn(node), createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node),
    createBuffer: vi.fn(() => ({ getChannelData: () => samples })),
    startRendering: vi.fn().mockResolvedValue({ rendered: true }),
  }
  return { ctx, nodes }
}

describe('voz Web Audio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('combina harmonicos fracos e corpo desafinado com entrada de afinacao suave', () => {
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 1)
    const [fundamental, second, third, body] = ctx.createOscillator.mock.results.map(result => result.value)
    const [secondGain, thirdGain, bodyGain, air, chiff, depth, driftDepth, envelope] = ctx.createGain.mock.results.map(result => result.value)
    expect([fundamental, second, third, body].map(tone => tone.frequency.value)).toEqual([440, 880, 1320, 440])
    for (const tone of [fundamental, second, third, body]) {
      expect(tone.type).toBe('sine')
      const cents = tone === body ? 4 : 0
      expect(tone.detune.setValueAtTime).toHaveBeenCalledWith(cents - 25, 1)
      expect(tone.detune.linearRampToValueAtTime).toHaveBeenCalledWith(cents, 1.05)
      expect(depth.connect).toHaveBeenCalledWith(tone.detune)
    }
    expect(secondGain.gain.value).toBe(0.02)
    expect(thirdGain.gain.value).toBe(0.04)
    expect(bodyGain.gain.value).toBe(0.1)
    expect(fundamental.connect).toHaveBeenCalledWith(envelope)
    for (const [tone, gain] of [[second, secondGain], [third, thirdGain], [body, bodyGain]]) {
      expect(tone.connect).toHaveBeenCalledWith(gain)
      expect(gain.connect).toHaveBeenCalledWith(envelope)
    }
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 1.03)
    // Margem nominal mesmo somando quatro vozes e o pico do chiff.
    expect(4 * 0.2 * (1 + secondGain.gain.value + thirdGain.gain.value + bodyGain.gain.value + air.gain.value + 0.05)).toBeLessThan(1)
    expect(chiff).toBeDefined()
    expect(driftDepth).toBeDefined()
  })

  it('chiff decai em 40ms e sopro continuo passa pelo filtro de saida', () => {
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 1)
    const [noise] = ctx.createBufferSource.mock.results.map(result => result.value)
    const [breathFilter, output] = ctx.createBiquadFilter.mock.results.map(result => result.value)
    const [, , , air, chiff, , , envelope] = ctx.createGain.mock.results.map(result => result.value)
    expect(noise.loop).toBe(true)
    expect(noise.buffer).not.toBeNull()
    expect(noise.connect).toHaveBeenCalledWith(breathFilter)
    expect(breathFilter.type).toBe('bandpass')
    expect(breathFilter.frequency.value).toBe(880)
    expect(breathFilter.Q.value).toBe(0.7)
    expect(breathFilter.connect).toHaveBeenCalledWith(air)
    expect(breathFilter.connect).toHaveBeenCalledWith(chiff)
    expect(air.gain.value).toBe(0.008)
    expect(chiff.gain.setValueAtTime).toHaveBeenCalledWith(0.05, 1)
    expect(chiff.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.04)
    expect(air.connect).toHaveBeenCalledWith(envelope)
    expect(chiff.connect).toHaveBeenCalledWith(envelope)
    expect(envelope.connect).toHaveBeenCalledWith(output)
    expect(output.type).toBe('lowpass')
    expect(output.frequency.value).toBe(3500)
    expect(output.Q.value).toBe(0.5)
    expect(output.connect).toHaveBeenCalledWith(ctx.destination)
  })

  it('vibrato cresce de 150 a 500ms com taxa levemente variavel', () => {
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 1)
    const [, , , , vibrato, drift] = ctx.createOscillator.mock.results.map(result => result.value)
    const [, , , , , depth, driftDepth] = ctx.createGain.mock.results.map(result => result.value)
    expect(vibrato.frequency.value).toBe(5.2)
    expect(vibrato.connect).toHaveBeenCalledWith(depth)
    expect(depth.gain.setValueAtTime.mock.calls).toEqual([[0, 1], [0, 1.15]])
    expect(depth.gain.linearRampToValueAtTime).toHaveBeenCalledWith(12, 1.5)
    expect(drift.frequency.value).toBe(0.23)
    expect(driftDepth.gain.value).toBe(0.12)
    expect(drift.connect).toHaveBeenCalledWith(driftDepth)
    expect(driftDepth.connect).toHaveBeenCalledWith(vibrato.frequency)
  })

  it('release durante ataque e idempotente; todos os nos desconectam ao terminar', () => {
    const { ctx, nodes } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0)
    voice.stop(0.01, 0.06)
    voice.stop(0.02)
    const envelope = ctx.createGain.mock.results[7].value
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2 * 0.01 / 0.03, 0.01)
    expect(envelope.gain.setValueAtTime).toHaveBeenCalledTimes(1)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.01 + 0.06)
    const sources = [...ctx.createOscillator.mock.results, ...ctx.createBufferSource.mock.results].map((result) => result.value)
    for (const source of sources) {
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.stop).toHaveBeenCalledWith(0.01 + 0.06)
    }
    for (const source of sources.slice(0, -1)) source.onended!()
    for (const node of nodes.slice(1)) expect(node.disconnect).not.toHaveBeenCalled()
    sources.at(-1)!.onended!()
    for (const node of nodes.slice(1)) expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it('soltar a voz no mesmo frame mantem 90ms antes do release', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0)
    voice.stop(0)
    const envelope = ctx.createGain.mock.results[7].value
    expect(envelope.gain.setValueAtTime).toHaveBeenLastCalledWith(0.2, 0.09)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.09 + 0.09)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop).toHaveBeenCalledWith(0.09 + 0.09)
  })

  it('renderNotes inclui a nota instantanea com sustentacao minima', async () => {
    const { ctx } = context()
    vi.stubGlobal('OfflineAudioContext', vi.fn(function () { return ctx }))
    await renderNotes([{ time: 0.2, duration: 0, midi: 60 }], 2, 48000)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(6)
    const envelope = ctx.createGain.mock.results[7].value
    expect(envelope.gain.setValueAtTime.mock.calls.at(-1)![1]).toBeCloseTo(0.29)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop.mock.calls[0][0]).toBeCloseTo(0.38)
  })

  it('renderiza mono com tamanho exato e release dentro do loop', async () => {
    const { ctx } = context()
    const Offline = vi.fn(function () { return ctx })
    vi.stubGlobal('OfflineAudioContext', Offline)
    const buffer = await renderNotes([{ time: 1, duration: 3, midi: 60 }, { time: 2, duration: 1, midi: 62 }], 2, 48000)
    expect(Offline).toHaveBeenCalledWith(1, 96000, 48000)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(6)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop).toHaveBeenCalledWith(2)
    expect(ctx.startRendering).toHaveBeenCalledTimes(1)
    expect(buffer).toEqual({ rendered: true })
  })
})
