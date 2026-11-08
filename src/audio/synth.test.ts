import { afterEach, describe, expect, it, vi } from 'vitest'
import { noteWindow, renderNotes, startVoice } from './synth'
import { INSTRUMENTS } from './types'

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
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }
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
  const ctx = {
    currentTime: 0, sampleRate: 48000, destination: node(),
    createOscillator: vi.fn(node), createGain: vi.fn(node), createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const samples = new Float32Array(length)
      return { length, sampleRate, numberOfChannels: channels, getChannelData: () => samples }
    }),
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

  it('corte forcado encurta release ja iniciado sem salto no ganho', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0)
    voice.stop(0)
    ctx.currentTime = 0.12
    voice.stop(0.12, 0.02)
    voice.stop(0.13, 0.02)
    const envelope = ctx.createGain.mock.results[7].value
    const ramps = envelope.gain.linearRampToValueAtTime.mock.calls
    expect(ramps.at(-2)![0]).toBeCloseTo(0.2 * (0.18 - 0.12) / 0.09)
    expect(ramps.at(-2)![1]).toBe(0.12)
    expect(ramps.at(-1)![0]).toBe(0)
    expect(ramps.at(-1)![1]).toBeCloseTo(0.14)
    for (const result of ctx.createOscillator.mock.results) {
      expect(result.value.stop).toHaveBeenCalledTimes(2)
      expect(result.value.stop.mock.calls.at(-1)![0]).toBeCloseTo(0.14)
    }
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


describe('presets de instrumento', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('flauta tem mais ar, segundo harmonico, ataque lento e vibrato antecipado', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 1, 'flute')
    const gains = ctx.createGain.mock.results.map(result => result.value)
    const [second, , , air, , depth, , envelope] = gains
    expect(second.gain.value).toBe(0.12)
    expect(air.gain.value).toBe(0.035)
    expect(ctx.createBiquadFilter.mock.results[0].value.type).toBe('bandpass')
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.18, 1.06)
    expect(depth.gain.setValueAtTime).toHaveBeenCalledWith(0, 1.12)
    voice.stop(1.2)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.2 + 0.12)
  })

  it('kalimba tem parciais inarmonicos, clique e decaimentos mais curtos nos parciais', () => {
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 0, 'kalimba')
    const tones = ctx.createOscillator.mock.results.map(result => result.value)
    expect(tones.map(tone => tone.frequency.value)).toEqual([440, 440 * 5.4, 440 * 8.9])
    const [upper, highest, air, click, envelope] = ctx.createGain.mock.results.map(result => result.value)
    expect(upper.gain.value).toBe(0.15)
    expect(highest.gain.value).toBe(0.07)
    expect(upper.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 0.3)
    expect(highest.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 0.15)
    expect(air.gain.value).toBe(0)
    expect(click.gain.setValueAtTime).toHaveBeenCalledWith(0.08, 0)
    expect(click.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.012)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.18, 0.003)
    expect(envelope.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 1.5)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.51)
    expect(tones).toHaveLength(3)
    for (const tone of tones) expect(tone.detune.linearRampToValueAtTime).not.toHaveBeenCalled()
  })

  it('kalimba ignora noteOff mas permite corte explicito com rampa durante o decaimento', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0, 'kalimba')
    const envelope = ctx.createGain.mock.results.at(-1)!.value
    const sources = [...ctx.createOscillator.mock.results, ...ctx.createBufferSource.mock.results].map(result => result.value)
    voice.stop(0)
    voice.stop(0.1)
    expect(envelope.gain.cancelScheduledValues).not.toHaveBeenCalled()
    for (const source of sources) expect(source.stop.mock.calls).toEqual([[1.51]])
    voice.stop(0.2, 0.02)
    voice.stop(0.3, 0.02)
    expect(envelope.gain.cancelScheduledValues).toHaveBeenCalledExactlyOnceWith(0.2)
    const level = envelope.gain.setValueAtTime.mock.calls.at(-1)![0] as number
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(0.18)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.22)
    for (const source of sources) expect(source.stop.mock.calls).toEqual([[1.51], [0.22]])
  })

  it('baixo sustenta os harmonicos e fecha o filtro em 150ms sem vibrato', () => {
    const { ctx } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 36, 0, 'bass')
    const tones = ctx.createOscillator.mock.results.map(result => result.value)
    expect(tones).toHaveLength(3)
    expect(tones[1].frequency.value).toBe(tones[0].frequency.value * 2)
    expect(tones[2].frequency.value).toBe(tones[0].frequency.value * 3)
    const [second, third, envelope] = ctx.createGain.mock.results.map(result => result.value)
    expect(second.gain.value).toBe(0.22)
    expect(third.gain.value).toBe(0.08)
    expect(4 * 0.17 * (1 + second.gain.value + third.gain.value)).toBeLessThan(1)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.17, 0.008)
    expect(envelope.gain.exponentialRampToValueAtTime).not.toHaveBeenCalled()
    const filter = ctx.createBiquadFilter.mock.results[0].value
    expect(filter.type).toBe('lowpass')
    expect(filter.Q.value).toBe(0.5)
    expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(2200, 0)
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(500, 0.15)
    expect(envelope.connect).toHaveBeenCalledWith(filter)
    expect(filter.connect).toHaveBeenCalledWith(ctx.destination)
    expect(ctx.createBufferSource).not.toHaveBeenCalled()
    for (const tone of tones) expect(tone.stop).not.toHaveBeenCalled()
    voice.stop(0)
    expect(envelope.gain.setValueAtTime).toHaveBeenLastCalledWith(0.17, 0.09)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.09 + 0.08)
  })

  it.each(INSTRUMENTS)('%s desconecta todos os nos somente depois da ultima fonte', instrument => {
    const { ctx, nodes } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 60, 0, instrument)
    const ended = vi.fn()
    voice.onEnded(ended)
    if (instrument !== 'kalimba') voice.stop(0.1)
    const sources = [...ctx.createOscillator.mock.results, ...ctx.createBufferSource.mock.results].map(result => result.value)
    for (const source of sources.slice(0, -1)) source.onended!()
    expect(ended).not.toHaveBeenCalled()
    for (const node of nodes.slice(1)) expect(node.disconnect).not.toHaveBeenCalled()
    sources.at(-1)!.onended!()
    expect(ended).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    voice.onEnded(late)
    expect(late).toHaveBeenCalledTimes(1)
    for (const node of nodes.slice(1)) expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ocarina', 6, 0.38], ['flute', 6, 0.41], ['kalimba', 3, 1.71], ['bass', 3, 0.37],
  ] as const)('renderNotes usa %s e sua cauda propria com nota instantanea', async (instrument, oscillators, end) => {
    const { ctx } = context()
    const Offline = vi.fn(function () { return ctx })
    vi.stubGlobal('OfflineAudioContext', Offline)
    await renderNotes([{ time: 0.2, duration: 0, midi: 60 }], 2, 48000, instrument)
    expect(Offline).toHaveBeenCalledWith(1, 96000, 48000)
    expect(ctx.createOscillator).toHaveBeenCalledTimes(oscillators)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop.mock.calls.at(-1)![0]).toBeCloseTo(end)
    expect(ctx.startRendering).toHaveBeenCalledOnce()
  })

  it.each(INSTRUMENTS)('renderNotes recorta a cauda de %s na borda do loop com rampa', async instrument => {
    const { ctx } = context()
    vi.stubGlobal('OfflineAudioContext', vi.fn(function () { return ctx }))
    await renderNotes([{ time: 1.99, duration: 1, midi: 60 }], 2, 48000, instrument)
    for (const result of ctx.createOscillator.mock.results) expect(result.value.stop.mock.calls.at(-1)![0]).toBe(2)
    const envelope = ctx.createGain.mock.results.at(-1)!.value
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 2)
  })

  it('ocarina explicita e default preservam o mesmo grafo e envelopes', () => {
    const graphs = [undefined, 'ocarina' as const].map(instrument => {
      const { ctx } = context()
      startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 69, 1, instrument).stop(1.4)
      return {
        tones: ctx.createOscillator.mock.results.map(({ value }) => [value.frequency.value, value.detune.setValueAtTime.mock.calls]),
        gains: ctx.createGain.mock.results.map(({ value }) => [value.gain.value, value.gain.setValueAtTime.mock.calls, value.gain.linearRampToValueAtTime.mock.calls]),
        filters: ctx.createBiquadFilter.mock.results.map(({ value }) => [value.type, value.frequency.value, value.Q.value]),
      }
    })
    expect(graphs[0]).toEqual(graphs[1])
  })
})


describe('cavaquinho Karplus-Strong', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('gera corda finita de 1.2s, com pico controlado e energia decrescente', () => {
    let seed = 21
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    })
    const { ctx } = context()
    startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 77, 0, 'cavaquinho')
    expect(ctx.createOscillator).not.toHaveBeenCalled()
    const source = ctx.createBufferSource.mock.results[0].value
    const buffer = source.buffer!
    expect(buffer.length).toBe(57600)
    expect(buffer.sampleRate).toBe(48000)
    expect(buffer.numberOfChannels).toBe(1)
    const samples: Float32Array = buffer.getChannelData(0)
    const rms = (start: number, end: number) => {
      const slice = samples.subarray(Math.round(start * 48000), Math.round(end * 48000))
      return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length)
    }
    const head = rms(0.01, 0.1), middle = rms(0.5, 0.6), tail = rms(1, 1.1)
    expect(head).toBeGreaterThan(0.01)
    expect(middle).toBeLessThan(head * 0.5)
    expect(tail).toBeLessThan(middle * 0.5)
    expect(samples.every(Number.isFinite)).toBe(true)
    expect(Math.abs(samples[0])).toBe(0)
    expect(Math.abs(samples.at(-1)!)).toBe(0)
    let peak = 0
    for (const value of samples) peak = Math.max(peak, Math.abs(value))
    expect(peak).toBeCloseTo(0.9)
    expect(4 * peak * 0.22).toBeLessThan(1)
    expect(source.loop).toBe(false)
  })

  it('reutiliza o buffer por MIDI/sampleRate inclusive entre contextos', () => {
    const first = context(), second = context()
    const play = (ctx: ReturnType<typeof context>['ctx'], midi: number) => {
      startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, midi, 0, 'cavaquinho')
      return ctx.createBufferSource.mock.results.at(-1)!.value.buffer
    }
    const buffer = play(first.ctx, 78)
    expect(play(first.ctx, 78)).toBe(buffer)
    expect(play(second.ctx, 78)).toBe(buffer)
    expect(second.ctx.createBuffer).not.toHaveBeenCalled()
    expect(play(second.ctx, 79)).not.toBe(buffer)
    second.ctx.sampleRate = 44100
    const otherRate = play(second.ctx, 78)!
    expect(otherRate).not.toBe(buffer)
    expect(otherRate.length).toBe(Math.ceil(44100 * 1.2))
    expect(otherRate.sampleRate).toBe(44100)
  })

  it('noteOff abafa em 80ms respeitando 90ms e corte forcado pode antecipar a cauda', () => {
    const { ctx, nodes } = context()
    const voice = startVoice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, 80, 0, 'cavaquinho')
    const source = ctx.createBufferSource.mock.results[0].value
    const envelope = ctx.createGain.mock.results[0].value
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.22, 0.001)
    expect(source.connect).toHaveBeenCalledWith(envelope)
    voice.stop(0)
    expect(envelope.gain.setValueAtTime).toHaveBeenLastCalledWith(0.22, 0.09)
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.09 + 0.08)
    expect(source.stop).toHaveBeenLastCalledWith(0.09 + 0.08)
    voice.stop(0.1, 0.01)
    expect(source.stop).toHaveBeenLastCalledWith(0.11)
    const ended = vi.fn()
    voice.onEnded(ended)
    source.onended!()
    expect(ended).toHaveBeenCalledOnce()
    for (const node of nodes.slice(1)) expect(node.disconnect).toHaveBeenCalledOnce()
  })

  it('render offline toca cavaquinho e recorta noteOff mais release no loop', async () => {
    const { ctx } = context()
    const Offline = vi.fn(function () { return ctx })
    vi.stubGlobal('OfflineAudioContext', Offline)
    await renderNotes([{ time: 0.2, duration: 0.3, midi: 81 }], 2, 48000, 'cavaquinho')
    expect(Offline).toHaveBeenCalledWith(1, 96000, 48000)
    expect(ctx.createOscillator).not.toHaveBeenCalled()
    expect(ctx.createBufferSource).toHaveBeenCalledOnce()
    const source = ctx.createBufferSource.mock.results[0].value
    expect(source.buffer).not.toBeNull()
    expect(source.start).toHaveBeenCalledWith(0.2)
    expect(source.stop.mock.calls.at(-1)![0]).toBeCloseTo(0.58)
    expect(ctx.startRendering).toHaveBeenCalledOnce()
  })
})
