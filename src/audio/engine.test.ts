import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createEngine } from './engine'
import * as synth from './synth'
import * as drums from './drums'
import * as kits from './kits'
import * as groove from './groove'
import { INSTRUMENTS } from './types'

describe('nomes das faixas', () => {
  it('inclui os nomes padrão no estado e nos projetos exportados', () => {
    const engine = createEngine({ tracks: 2 })
    expect(engine.getState().tracks.map((t) => t.name)).toEqual(['Faixa 1', 'Faixa 2', 'Bateria'])
    expect(engine.exportProject().tracks.map((t) => t.name)).toEqual(['Faixa 1', 'Faixa 2', 'Bateria'])
    engine.dispose()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
})
function audioNode() {
  return {
    connect: vi.fn((dest: unknown) => dest), disconnect: vi.fn(),
    gain: param(), frequency: param(), pan: param(), delayTime: param(), Q: param(),
    start: vi.fn(), stop: vi.fn(), onended: null,
    fftSize: 256,
    getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(0.1)),
  }
}
class TestBuffer {
  sampleRate: number
  length: number
  private channels: Float32Array[]
  constructor(opts: { sampleRate: number; length: number; numberOfChannels: number }) {
    this.sampleRate = opts.sampleRate
    this.length = opts.length
    this.channels = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length))
  }
  getChannelData(i: number) { return this.channels[i] }
  copyToChannel(data: Float32Array, i: number) { this.channels[i].set(data) }
}
class TestContext {
  static instances: TestContext[] = []
  currentTime = 0
  sampleRate = 100
  baseLatency = 0.01
  outputLatency = 0.01
  state = 'running'
  destination = audioNode()
  onstatechange = null
  gains: ReturnType<typeof audioNode>[] = []
  sources: ReturnType<typeof audioNode>[] = []
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { TestContext.instances.push(this) }
  createGain() { const node = audioNode(); this.gains.push(node); return node }
  createDelay = audioNode
  createBiquadFilter = audioNode
  createStereoPanner = audioNode
  createConvolver = audioNode
  createAnalyser = audioNode
  createOscillator = audioNode
  bufferSources: ReturnType<typeof audioNode>[] = []
  createBufferSource() { const node = audioNode(); this.bufferSources.push(node); return node }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new TestBuffer({ numberOfChannels: channels, length, sampleRate })
  }
  createMediaStreamSource() { const node = audioNode(); this.sources.push(node); return node }
  createMediaStreamDestination() { return { ...audioNode(), stream: {} } }
}
class TestWorklet {
  static instances: TestWorklet[] = []
  port = { onmessage: null, close: vi.fn(), postMessage: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { TestWorklet.instances.push(this) }
}
function micStream() {
  const track = { readyState: 'live', onended: null as (() => void) | null, stop: vi.fn(), getSettings: () => ({ latency: 0.03 }) }
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream }
}

describe('audio sem permissao de microfone', () => {
  let getUserMedia: ReturnType<typeof vi.fn>
  let engine: ReturnType<typeof createEngine>
  beforeEach(() => {
    vi.useFakeTimers()
    TestContext.instances = []
    TestWorklet.instances = []
    getUserMedia = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('AudioContext', TestContext)
    vi.stubGlobal('AudioBuffer', TestBuffer)
    vi.stubGlobal('AudioWorkletNode', TestWorklet)
    engine = createEngine({ tracks: 2 })
  })
  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('inicializa uma vez e toca bateria sem pedir captura', async () => {
    const first = engine.init()
    expect(engine.init()).toBe(first)
    await first
    expect(engine.getState()).toMatchObject({ status: 'ready', mic: 'off', micError: null, micTrack: null })
    engine.triggerDrum(0)
    engine.toggleStep(0, 0)
    engine.play()
    expect(engine.getState().playing).toBe(true)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(TestContext.instances[0].audioWorklet.addModule).not.toHaveBeenCalled()
    expect(engine.getInputLevel()).toBe(0)
  })

  it('init seguido de import de take ocarina e play inicia e mantem o transporte', async () => {
    const draft = engine.exportProject()
    draft.key = 'G'
    draft.sampleRate = 48000
    draft.tracks[0].source = 'ocarina'
    draft.tracks[0].audio = new Float32Array(4800).fill(0.2)
    await engine.init()
    engine.importProject(draft)
    engine.play()
    expect(engine.getState()).toMatchObject({ playing: true, key: 'G' })
    expect(engine.getState().tracks[0]).toMatchObject({ source: 'ocarina', status: 'recorded' })
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getState().playing).toBe(true)
    expect(TestContext.instances[0].resume).toHaveBeenCalledTimes(2)
  })

  it('compartilha o pedido concorrente, mede a entrada e libera todos os recursos', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    const mic = micStream()
    getUserMedia.mockReturnValue(capture.promise)
    const first = engine.ensureMic()
    expect(engine.ensureMic()).toBe(first)
    expect(engine.getState().mic).toBe('requesting')
    capture.resolve(mic.stream)
    expect(await first).toBe(true)
    expect(await engine.ensureMic()).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(engine.getInputLevel()).toBeCloseTo(28 / 48)
    engine.dispose()
    expect(mic.track.stop).toHaveBeenCalled()
    expect(TestContext.instances[0].sources[0].disconnect).toHaveBeenCalled()
    expect(TestWorklet.instances[0].port.close).toHaveBeenCalled()
    expect(engine.getInputLevel()).toBe(0)
  })

  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'UnknownError'])(
    'resolve false para %s e permite tentar de novo', async (name) => {
      await engine.init()
      getUserMedia.mockRejectedValueOnce(new DOMException('sem captura', name))
      expect(await engine.ensureMic()).toBe(false)
      expect(engine.getState()).toMatchObject({ status: 'ready', mic: name === 'NotAllowedError' ? 'denied' : 'missing', micError: 'sem captura' })
      getUserMedia.mockResolvedValueOnce(micStream().stream)
      expect(await engine.ensureMic()).toBe(true)
    },
  )

  it('arma somente a ultima faixa pedida quando a permissao chega', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    getUserMedia.mockReturnValue(capture.promise)
    engine.record(0)
    engine.record(1)
    expect(engine.getState().micTrack).toBe(1)
    const pending = engine.ensureMic()
    capture.resolve(micStream().stream)
    await pending
    expect(engine.getState().micTrack).toBeNull()
    expect(engine.getState().tracks.map((t) => t.status)).toEqual(['empty', 'armed', 'empty'])
  })

  it('cancela a intencao repetida sem cancelar o prompt', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    getUserMedia.mockReturnValue(capture.promise)
    engine.record(0)
    engine.record(0)
    const pending = engine.ensureMic()
    expect(engine.getState().micTrack).toBeNull()
    capture.resolve(micStream().stream)
    await pending
    expect(engine.getState().tracks[0].status).toBe('empty')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('mantem a faixa do erro e arma ao tentar novamente', async () => {
    await engine.init()
    getUserMedia.mockRejectedValueOnce(new DOMException('negado', 'NotAllowedError'))
    engine.record(0)
    await engine.ensureMic()
    expect(engine.getState().micTrack).toBe(0)
    getUserMedia.mockResolvedValueOnce(micStream().stream)
    engine.record(0)
    await engine.ensureMic()
    expect(engine.getState().tracks[0].status).toBe('armed')
  })

  it('descarta stream concedido depois do dispose', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    const mic = micStream()
    getUserMedia.mockReturnValue(capture.promise)
    const pending = engine.ensureMic()
    engine.dispose()
    capture.resolve(mic.stream)
    expect(await pending).toBe(false)
    expect(mic.track.stop).toHaveBeenCalled()
    expect(engine.getState()).toMatchObject({ status: 'disposed', mic: 'off' })
    expect(TestWorklet.instances).toHaveLength(0)
  })

  it('libera o stream se dispose ocorrer ao carregar o worklet', async () => {
    await engine.init()
    const module = deferred<void>()
    const mic = micStream()
    getUserMedia.mockResolvedValue(mic.stream)
    TestContext.instances[0].audioWorklet.addModule.mockReturnValue(module.promise)
    const pending = engine.ensureMic()
    await Promise.resolve()
    engine.dispose()
    module.resolve()
    expect(await pending).toBe(false)
    expect(mic.track.stop).toHaveBeenCalled()
    expect(TestWorklet.instances).toHaveLength(0)
  })

  it('desconexao cancela capturas sem parar o transporte e permite reconectar', async () => {
    await engine.init()
    const mic = micStream()
    getUserMedia.mockResolvedValue(mic.stream)
    await engine.ensureMic()
    engine.play()
    engine.record(0)
    TestContext.instances[0].currentTime = 10
    vi.advanceTimersByTime(25)
    expect(engine.getState().tracks[0].status).toBe('recording')
    engine.record(1)
    expect(engine.getState().tracks[1].status).toBe('armed')
    mic.track.onended!()
    expect(engine.getState()).toMatchObject({ status: 'ready', playing: true, mic: 'missing' })
    expect(engine.getState().tracks.slice(0, 2).map((t) => t.status)).toEqual(['empty', 'empty'])
    expect(engine.getInputLevel()).toBe(0)
    getUserMedia.mockResolvedValue(micStream().stream)
    expect(await engine.ensureMic()).toBe(true)
  })

  it('falha de worklet libera o stream sem inutilizar a saida', async () => {
    await engine.init()
    const mic = micStream()
    getUserMedia.mockResolvedValue(mic.stream)
    TestContext.instances[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet indisponivel'))
    expect(await engine.ensureMic()).toBe(false)
    expect(mic.track.stop).toHaveBeenCalled()
    expect(engine.getState()).toMatchObject({ status: 'ready', mic: 'missing', micError: 'worklet indisponivel' })
    getUserMedia.mockResolvedValue(micStream().stream)
    expect(await engine.ensureMic()).toBe(true)
  })

  it('stop cancela a gravacao pendente sem descartar a permissao tardia', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    getUserMedia.mockReturnValue(capture.promise)
    engine.record(0)
    const pending = engine.ensureMic()
    engine.stop()
    capture.resolve(micStream().stream)
    expect(await pending).toBe(true)
    expect(engine.getState()).toMatchObject({ micTrack: null, playing: false })
    expect(engine.getState().tracks[0].status).toBe('empty')
  })

  it('calibracao remove intencao negada sem substituir o take existente', async () => {
    await engine.init()
    const project = engine.exportProject()
    const audio = Float32Array.of(0.2, -0.4, 0.6)
    project.tracks[0].audio = audio
    engine.importProject(project)
    const previous = engine.getState().tracks[0]
    getUserMedia.mockRejectedValueOnce(new DOMException('negado', 'NotAllowedError'))
    engine.record(0)
    await engine.ensureMic()
    expect(engine.getState().micTrack).toBe(0)
    getUserMedia.mockResolvedValueOnce(micStream().stream)
    const onClick = vi.fn()
    const calibration = engine.calibrateLatency({ clicks: 2, onClick })
    expect(engine.getState().micTrack).toBeNull()
    await vi.runAllTimersAsync()
    expect(await calibration).toBeNull()
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(engine.exportProject().tracks[0].audio).toEqual(audio)
    expect(engine.getState().tracks[0]).toEqual(previous)
  })

  it('preserva faixa armada por um novo pedido durante o prompt da calibracao', async () => {
    await engine.init()
    const capture = deferred<MediaStream>()
    getUserMedia.mockReturnValue(capture.promise)
    const onClick = vi.fn()
    const calibration = engine.calibrateLatency({ onClick })
    engine.record(1)
    capture.resolve(micStream().stream)
    expect(await calibration).toBeNull()
    expect(engine.getState()).toMatchObject({ mic: 'ready', playing: true })
    expect(engine.getState().tracks[1].status).toBe('armed')
    expect(onClick).not.toHaveBeenCalled()
    expect(TestWorklet.instances[0].port.postMessage).toHaveBeenLastCalledWith(true)
  })

  it('recusa calibracao sem interromper uma faixa gravando', async () => {
    await engine.init()
    getUserMedia.mockResolvedValue(micStream().stream)
    await engine.ensureMic()
    engine.record(0)
    TestContext.instances[0].currentTime = 10
    vi.advanceTimersByTime(25)
    expect(engine.getState().tracks[0].status).toBe('recording')
    expect(await engine.calibrateLatency()).toBeNull()
    expect(engine.getState().tracks[0].status).toBe('recording')
    expect(engine.getState().playing).toBe(true)
  })

  it('calibracao sem intencao pendente inicia captura e toca os cliques', async () => {
    await engine.init()
    getUserMedia.mockResolvedValue(micStream().stream)
    const onClick = vi.fn()
    const calibration = engine.calibrateLatency({ clicks: 2, onClick })
    await vi.runAllTimersAsync()
    expect(await calibration).toBeNull()
    expect(engine.getState()).toMatchObject({ mic: 'ready', micTrack: null, playing: false })
    expect(onClick.mock.calls).toEqual([[0], [1]])
    expect(TestWorklet.instances[0].port.postMessage.mock.calls).toEqual([[true], [false]])
    expect(engine.getState().tracks.every((track) => track.status === 'empty')).toBe(true)
  })

  it('calibracao sem permissao resolve null e deixa bateria disponivel', async () => {
    await engine.init()
    getUserMedia.mockRejectedValue(new DOMException('negado', 'NotAllowedError'))
    expect(await engine.calibrateLatency()).toBeNull()
    expect(engine.getState().status).toBe('ready')
    engine.play()
    expect(engine.getState().playing).toBe(true)
  })

  it('aplica fade de 800ms apenas no primeiro play e respeita volume durante a rampa', async () => {
    await engine.init()
    const ctx = TestContext.instances[0]
    const master = ctx.gains[0].gain
    engine.setMasterVolume(0.6)
    engine.play()
    expect(master.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
    expect(master.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.6, 0.8)
    ctx.currentTime = 0.4
    engine.setMasterVolume(0.4)
    expect(master.setValueAtTime).toHaveBeenLastCalledWith(0.2, 0.4)
    expect(master.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.4, 0.8)
    ctx.currentTime = 1
    engine.stop()
    master.linearRampToValueAtTime.mockClear()
    engine.play()
    expect(master.linearRampToValueAtTime).not.toHaveBeenCalled()
  })

  describe('swing e roda', () => {
    it('limita swing, exporta e importa com default zero para projeto antigo', async () => {
      await engine.init()
      expect(engine.getState().swing).toBe(0)
      engine.setSwing(2)
      expect(engine.getState().swing).toBe(0.5)
      engine.setSwing(-1)
      expect(engine.getState().swing).toBe(0)
      engine.setSwing(0.3)
      engine.setSwing(NaN)
      const project = engine.exportProject()
      expect(project.swing).toBe(0.3)
      engine.setSwing(0)
      engine.importProject(project)
      expect(engine.getState().swing).toBe(0.3)
      delete project.swing
      engine.importProject(project)
      expect(engine.getState().swing).toBe(0)
    })

    it.each([false, true])('scheduler atrasa somente impares, liveDrums=%s', async (live) => {
      await engine.init()
      engine.setBpm(120)
      engine.setBars(1)
      engine.setMetronome(false)
      engine.setLiveDrums(live)
      engine.setSwing(0.5)
      engine.setPattern([[true]])
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 0.7, offset: 0.003 })
      engine.play()
      const ctx = TestContext.instances[0]
      for (const time of [0.15, 0.25, 0.4]) { ctx.currentTime = time; vi.advanceTimersByTime(25) }
      const expected = [0.05, 0.2375, 0.3, 0.4875]
      expect(play).toHaveBeenCalledTimes(4)
      for (let i = 0; i < expected.length; i++) expect(play.mock.calls[i][4]).toBeCloseTo(expected[i] + (live ? 0.003 : 0))
    })

    it('mantem contrapasso futuro mesmo com tempo reto passado e limita jitter no now', async () => {
      await engine.init()
      engine.setBpm(120)
      engine.setSwing(0.5)
      engine.setMetronome(false)
      engine.setPattern([[false, true]])
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 1, offset: -0.005 })
      engine.play()
      TestContext.instances[0].currentTime = 0.236
      vi.advanceTimersByTime(25)
      expect(play.mock.calls[0][4]).toBe(0.236)
    })

    it('render offline soma swing e humanizacao a partir da saida recortada', async () => {
      await engine.init()
      engine.setBpm(120)
      engine.setBars(1)
      engine.setSwing(0.5)
      engine.setPattern([[true]])
      class Offline extends TestContext {
        channels: number
        length: number
        constructor(channels: number, length: number, rate: number) { super(); this.channels = channels; this.length = length; this.sampleRate = rate }
        async startRendering() { return new TestBuffer({ numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate }) }
      }
      vi.stubGlobal('OfflineAudioContext', Offline)
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 0.6, offset: 0.003 })
      await engine.renderMix(1)
      const output = play.mock.calls.filter((call) => call[4] >= 4).slice(0, 4)
      const expected = [4.003, 4.1905, 4.253, 4.4405]
      expect(output).toHaveLength(4)
      for (let i = 0; i < 4; i++) expect(output[i][4]).toBeCloseTo(expected[i])
    })

    it('roda toca slot zero e swing nao muda take nem notas de instrumento', async () => {
      await engine.init()
      engine.setKit('roda')
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      engine.triggerDrum(0)
      expect(play.mock.calls[0].slice(2)).toEqual(['roda', 0, 0])
      engine.applyTake(0, Float32Array.of(0.3), { source: 'cavaquinho', notes: [{ step: 1, length: 2, midi: 60 }] })
      expect(engine.getState().tracks[0].reverb).toBe(0.12)
      const track = engine.getState().tracks[0]
      const audio = engine.getTakeAudio(0)
      engine.setSwing(0.4)
      expect(engine.getState().tracks[0]).toBe(track)
      expect(engine.getTakeAudio(0)).toEqual(audio)
      expect(engine.exportProject().kit).toBe('roda')
    })
  })

  describe('kits e oito slots', () => {
    it('estado inicial, setPattern e applyBatch normalizam quatro ou mais linhas para oito', async () => {
      await engine.init()
      expect(engine.getState().kit).toBe('acoustic')
      expect(engine.getState().pattern).toHaveLength(8)
      const four = Array.from({ length: 4 }, (_, i) => [i === 0, i === 1])
      engine.setPattern(four)
      expect(engine.getState().pattern.slice(4).every((row) => row.every((on) => !on))).toBe(true)
      expect(engine.getState().pattern[0].slice(0, 4)).toEqual([true, false, true, false])
      engine.applyBatch({ pattern: four })
      expect(engine.getState().pattern).toHaveLength(8)
      expect(engine.getState().pattern.slice(4).every((row) => row.every((on) => !on))).toBe(true)
      engine.setPattern(Array.from({ length: 10 }, () => [true]))
      expect(engine.getState().pattern).toHaveLength(8)
      engine.setBars(1)
      expect(engine.getState().pattern.every((row) => row.length === 16)).toBe(true)
    })

    it('migra projeto antigo de quatro linhas e valida kit salvo', async () => {
      await engine.init()
      const project = engine.exportProject()
      project.pattern = [[true], [false], [true], [false]]
      delete project.kit
      engine.setKit('808')
      engine.importProject(project)
      expect(engine.getState().kit).toBe('acoustic')
      expect(engine.getState().pattern).toHaveLength(8)
      expect(engine.getState().pattern.slice(4).every((row) => row.every((on) => !on))).toBe(true)
      project.kit = '808'
      engine.importProject(project)
      expect(engine.exportProject().kit).toBe('808')
      Object.assign(project, { kit: 'invalido' })
      engine.importProject(project)
      expect(engine.getState().kit).toBe('acoustic')
    })

    it('troca kit sem mudar padrao e slots altos definem status recorded', async () => {
      await engine.init()
      engine.toggleStep(7, 0)
      const pattern = engine.getState().pattern
      expect(engine.getState().tracks[2].status).toBe('recorded')
      engine.setKit('lofi')
      expect(engine.getState().pattern).toBe(pattern)
      expect(engine.exportProject().kit).toBe('lofi')
      engine.setKit('invalido' as never)
      expect(engine.getState().kit).toBe('lofi')
      engine.toggleStep(7, 0)
      expect(engine.getState().tracks[2].status).toBe('empty')
      const before = engine.getState()
      engine.toggleStep(8, 0)
      expect(engine.getState()).toBe(before)
    })

    it('triggerDrum toca slot 7 e ignora indices invalidos', async () => {
      await engine.init()
      engine.setKit('808')
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      engine.triggerDrum(7)
      expect(play.mock.calls[0].slice(2)).toEqual(['808', 7, 0])
      for (const slot of [-1, 8, 1.5, NaN]) engine.triggerDrum(slot)
      expect(play).toHaveBeenCalledTimes(1)
    })

    it('slot 5 acustico toca o tom e slots 0..3 delegam as vozes antigas', async () => {
      await engine.init()
      const osc = vi.spyOn(TestContext.instances[0], 'createOscillator')
      engine.triggerDrum(5)
      expect(osc.mock.results[0].value.frequency.setValueAtTime).toHaveBeenCalledWith(190, 0)
      expect(osc.mock.results[0].value.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(120, 0.08)
      const play = vi.spyOn(drums, 'playDrum').mockImplementation(() => {})
      for (let slot = 0; slot < 4; slot++) engine.triggerDrum(slot)
      expect(play.mock.calls.map((call) => call.slice(2))).toEqual([
        ['kick', 0, 1], ['snare', 0, 1], ['hat', 0, 1], ['clap', 0, 1],
      ])
    })

    it('scheduler usa slotRole para humanizar e kit atual para tocar slot alto', async () => {
      await engine.init()
      engine.setKit('808')
      engine.setMetronome(false)
      engine.toggleStep(7, 0)
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      const human = vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 0.6, offset: 0.003 })
      engine.play()
      expect(human.mock.calls[0][0]).toBe(kits.slotRole('808', 7))
      expect(human.mock.calls[0][1]).toBe(0)
      expect(play.mock.calls[0][2]).toBe('808')
      expect(play.mock.calls[0][3]).toBe(7)
      expect(play.mock.calls[0][4]).toBeCloseTo(0.053)
      expect(play.mock.calls[0][5]).toBe(0.6)
    })

    it('render offline usa kit 808 e preserva slots 5/7', async () => {
      await engine.init()
      engine.setKit('808')
      engine.setLiveDrums(false)
      engine.toggleStep(5, 0)
      engine.toggleStep(7, 1)
      class Offline extends TestContext {
        channels: number
        length: number
        constructor(channels: number, length: number, rate: number) { super(); this.channels = channels; this.length = length; this.sampleRate = rate }
        async startRendering() { return new TestBuffer({ numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate }) }
      }
      vi.stubGlobal('OfflineAudioContext', Offline)
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      await engine.renderMix(1)
      expect(play.mock.calls.every((call) => call[2] === '808')).toBe(true)
      expect(new Set(play.mock.calls.map((call) => call[3]))).toEqual(new Set([5, 7]))
    })
  })

  describe('bateria viva', () => {
    it('aplica velocity e offset, limita no now e mantem seed da sessao', async () => {
      await engine.init()
      engine.setMetronome(false)
      engine.setPattern([[true, true]])
      const play = vi.spyOn(drums, 'playDrum').mockImplementation(() => {})
      const human = vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 0.7, offset: 0.004 })
      engine.play()
      expect(play.mock.calls[0][3]).toBeCloseTo(0.054)
      expect(play.mock.calls[0][4]).toBe(0.7)
      const seed = human.mock.calls[0][2]
      human.mockReturnValue({ velocity: 0.8, offset: -0.005 })
      TestContext.instances[0].currentTime = 0.198
      vi.advanceTimersByTime(25)
      expect(play.mock.calls.at(-1)![3]).toBe(0.198)
      expect(human.mock.calls.at(-1)!).toEqual(['kick', 1, seed])
      engine.stop()
      engine.play()
      expect(human.mock.calls.at(-1)![2]).toBe(seed)
    })

    it('faz virada no compasso absoluto 3 e 7, mantendo o padrao salvo', async () => {
      await engine.init()
      engine.setBpm(120)
      engine.setBars(1)
      engine.setMetronome(false)
      engine.setPattern([[]])
      const pattern = engine.getState().pattern
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 1, offset: 0 })
      engine.play()
      const ctx = TestContext.instances[0]
      for (let step = 1; step < 128; step++) {
        ctx.currentTime = 0.05 + step * 0.125 - 0.001
        vi.advanceTimersByTime(25)
      }
      const hits = play.mock.calls.map((call) => Math.round((call[4] - 0.05) / 0.125))
      expect(hits).toEqual([56, 58, 60, 61, 62, 63, 120, 122, 124, 125, 126, 127])
      expect(play.mock.calls.map((call) => call[3])).toEqual([1, 1, 1, 5, 5, 5, 1, 1, 1, 5, 5, 5])
      expect(engine.getState().pattern).toBe(pattern)
    })

    it('desligado preserva passos e tempos exatos, sem humanizar nem gerar virada', async () => {
      await engine.init()
      engine.setLiveDrums(false)
      engine.setMetronome(false)
      engine.setPattern([[true]])
      const play = vi.spyOn(drums, 'playDrum').mockImplementation(() => {})
      const human = vi.spyOn(groove, 'humanize')
      const fill = vi.spyOn(groove, 'fillPattern')
      engine.play()
      expect(play.mock.calls[0].slice(2)).toEqual(['kick', 0.05, 1])
      expect(human).not.toHaveBeenCalled()
      expect(fill).not.toHaveBeenCalled()
    })

    it('renderMix conta virada a partir da saida recortada e usa mesma seed/offset', async () => {
      await engine.init()
      engine.setBpm(120)
      engine.setBars(1)
      class Offline extends TestContext {
        channels: number
        length: number
        constructor(channels: number, length: number, rate: number) { super(); this.channels = channels; this.length = length; this.sampleRate = rate }
        async startRendering() { return new TestBuffer({ numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate }) }
      }
      vi.stubGlobal('OfflineAudioContext', Offline)
      engine.setPattern([[true, false]])
      const play = vi.spyOn(kits, 'playKitVoice').mockImplementation(() => {})
      const human = vi.spyOn(groove, 'humanize').mockReturnValue({ velocity: 0.6, offset: 0.003 })
      engine.play()
      const seed = human.mock.calls[0][2]
      engine.stop()
      play.mockClear()
      human.mockClear()
      await engine.renderMix(4)
      const fill = play.mock.calls.filter((call) => call[3] === 1 || call[3] === 5)
      // 2 loops de pre-roll (4s), virada na barra 3: passo absoluto 56 em 7s.
      expect(fill.map((call) => call[4])).toEqual([11.003, 11.253, 11.503, 11.628, 11.753, 11.878])
      expect(fill.every((call) => call[5] === 0.6)).toBe(true)
      expect(human.mock.calls.every((call) => call[2] === seed)).toBe(true)
      expect(human.mock.calls.some((call) => call[1] === 56)).toBe(true)
      engine.setLiveDrums(false)
      play.mockClear()
      human.mockClear()
      await engine.renderMix(4)
      expect(play.mock.calls.some((call) => call[3] === 1 || call[3] === 5)).toBe(false)
      expect(human).not.toHaveBeenCalled()
    })
  })

  describe('lote atomico', () => {
    it.each(['armed', 'recording'] as const)('recusa lote inteiro em %s e com canal invalido/duplicado', async (status) => {
      await engine.init()
      engine.setTrack(1, { source: 'ocarina' })
      engine.record(1)
      if (status === 'recording') {
        TestContext.instances[0].currentTime = 3
        vi.advanceTimersByTime(25)
      }
      expect(engine.getState().tracks[1].status).toBe(status)
      const before = engine.getState()
      expect(engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(1) }], pattern: [[true]] })).toBe(false)
      expect(engine.getState()).toBe(before)
      engine.stop()
      const stopped = engine.getState()
      expect(engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(1) }, { track: 2, samples: Float32Array.of(1) }] })).toBe(false)
      expect(engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(1) }, { track: 0, samples: Float32Array.of(2) }] })).toBe(false)
      expect(engine.getState()).toBe(stopped)
    })

    it('prepara todos os buffers antes de qualquer mutacao', async () => {
      await engine.init()
      const before = engine.getState()
      vi.spyOn(TestContext.instances[0], 'createBuffer').mockImplementationOnce(() => new TestBuffer({ numberOfChannels: 1, length: 480, sampleRate: 100 })).mockImplementationOnce(() => { throw new Error('sem memoria') })
      expect(engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(1) }, { track: 1, samples: Float32Array.of(2) }] })).toBe(false)
      expect(engine.getState()).toBe(before)
      expect(engine.getTakeAudio(0)).toBeNull()
    })

    it.each(['create', 'connect', 'start', 'retire'] as const)('falha na segunda fonte em %s preserva tudo sem notificar', async (operation) => {
      await engine.init()
      engine.setLiveDrums(false)
      engine.setMetronome(false)
      engine.applyTake(0, Float32Array.of(0.1))
      engine.applyTake(0, Float32Array.of(0.2))
      engine.applyTake(1, Float32Array.of(0.3))
      engine.applyBatch({ pattern: [[true]] })
      engine.play()
      const ctx = TestContext.instances[0]
      ctx.currentTime = 0.5
      const previous = engine.getState()
      const project = engine.exportProject()
      const peaks = engine.getPeaks(0, 10)
      const originalSources = ctx.bufferSources.slice()
      if (operation === 'retire') originalSources[1].stop.mockImplementationOnce(() => { throw new Error('stop indisponivel') })
      const changed = vi.fn()
      engine.subscribe(changed)
      const create = ctx.createBufferSource.bind(ctx)
      let count = 0
      vi.spyOn(ctx, 'createBufferSource').mockImplementation(() => {
        count++
        if (count === 2 && operation === 'create') throw new Error('source indisponivel')
        const node = create()
        if (count === 2 && operation === 'connect') node.connect.mockImplementationOnce(() => { throw new Error('connect indisponivel') })
        if (count === 2 && operation === 'start') node.start.mockImplementationOnce(() => { throw new Error('start indisponivel') })
        return node
      })
      expect(engine.applyBatch({ takes: [
        { track: 0, samples: Float32Array.of(0.8), source: 'kalimba' },
        { track: 1, samples: Float32Array.of(0.9), source: 'ocarina' },
      ], pattern: [[false, true]] })).toBe(false)
      expect(engine.getState()).toBe(previous)
      expect(engine.exportProject()).toEqual(project)
      expect(engine.getPeaks(0, 10)).toBe(peaks)
      expect(changed).not.toHaveBeenCalled()
      if (operation === 'retire') {
        const restored = ctx.bufferSources.at(-1)!
        expect(restored.start.mock.calls[0][0]).toBeCloseTo(0.52)
        expect(restored.start.mock.calls[0][1]).toBeCloseTo(0.47)
        expect(ctx.bufferSources.slice(originalSources.length, -1).every((source) => source.disconnect.mock.calls.length === 1)).toBe(true)
      } else {
        for (const source of originalSources) expect(source.stop).not.toHaveBeenCalled()
        for (const source of ctx.bufferSources.slice(originalSources.length)) expect(source.disconnect).toHaveBeenCalledTimes(1)
      }
      engine.undoBatch()
      expect(engine.getState().pattern.some((row) => row.some(Boolean))).toBe(false)
      engine.undo(0)
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.1)
    })

    it('aplica tres takes e padrao com uma notificacao e restaura undo individual', async () => {
      engine.dispose()
      engine = createEngine({ tracks: 3 })
      await engine.init()
      for (let i = 0; i < 3; i++) {
        engine.applyTake(i, Float32Array.of(0.1 + i))
        engine.applyTake(i, Float32Array.of(0.2 + i))
      }
      engine.setPattern([[true, false]])
      const previous = engine.exportProject()
      const changed = vi.fn()
      engine.subscribe(changed)
      expect(engine.applyBatch({ takes: [
        { track: 0, samples: Float32Array.of(0, 1), sampleRate: 50, source: 'ocarina' },
        { track: 1, samples: Float32Array.of(0.6), source: 'flute' },
        { track: 2, samples: Float32Array.of(0.7), source: 'bass' },
      ], pattern: [[false, true]] })).toBe(true)
      expect(changed).toHaveBeenCalledTimes(1)
      expect(engine.getState().canUndoBatch).toBe(true)
      expect(engine.getState().tracks.every((track) => !track.canUndo)).toBe(true)
      expect(Array.from(engine.getTakeAudio(0)!.samples.slice(0, 5))).toEqual([0, 0.5, 1, 1, 0])
      engine.undoBatch()
      expect(changed).toHaveBeenCalledTimes(2)
      expect(engine.getState().canUndoBatch).toBe(false)
      expect(engine.exportProject().pattern).toEqual(previous.pattern)
      for (let i = 0; i < 3; i++) {
        expect(engine.getTakeAudio(i)!.samples).toEqual(previous.tracks[i].audio)
        expect(engine.getState().tracks[i]).toMatchObject({ source: 'mic', reverb: 0, canUndo: true })
        engine.undo(i)
        expect(engine.getTakeAudio(i)!.samples[0]).toBeCloseTo(0.1 + i)
      }
    })

    it.each(['toggleStep', 'setPattern', 'record', 'clear', 'applyTake', 'setBpm', 'setBars', 'removeTrack', 'importProject', 'clearAll', 'dispose'])(
      'invalida undo composto por %s', async (action) => {
        await engine.init()
        engine.setTrack(0, { source: 'ocarina' })
        expect(engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(0.2) }] })).toBe(true)
        if (action === 'toggleStep') engine.toggleStep(0, 0)
        else if (action === 'setPattern') engine.setPattern([[true]])
        else if (action === 'record') engine.record(0)
        else if (action === 'clear') engine.clear(0)
        else if (action === 'applyTake') engine.applyTake(0, Float32Array.of(0.5))
        else if (action === 'setBpm' || action === 'setBars') {
          engine.clear(0)
          engine.applyBatch({ pattern: [[true]] })
          if (action === 'setBpm') engine.setBpm(120)
          else engine.setBars(1)
        } else if (action === 'removeTrack') engine.removeTrack(0)
        else if (action === 'importProject') engine.importProject(engine.exportProject())
        else if (action === 'clearAll') engine.clearAll()
        else engine.dispose()
        expect(engine.getState().canUndoBatch).toBe(false)
      },
    )

    it('edicao de canal fora do lote nao invalida o snapshot', async () => {
      await engine.init()
      engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(0.2) }] })
      engine.applyTake(1, Float32Array.of(0.3))
      expect(engine.getState().canUndoBatch).toBe(true)
      engine.undoBatch()
      expect(engine.getTakeAudio(0)).toBeNull()
      expect(engine.getTakeAudio(1)!.samples[0]).toBeCloseTo(0.3)
    })
  })

  describe('remover e restaurar faixas', () => {
    it('desloca audio, params, nomes, undo e cache; restaura na posicao original', async () => {
      engine.dispose()
      engine = createEngine({ tracks: 3 })
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.1))
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina' })
      engine.setTrack(0, { name: 'Flauta', pan: 0.4 })
      engine.applyTake(1, Float32Array.of(0.3))
      engine.applyTake(1, Float32Array.of(0.4), { source: 'ocarina' })
      engine.setTrack(1, { volume: 0.6, delay: 0.3 })
      engine.applyTake(2, Float32Array.of(0.5))
      const previous = engine.getState().tracks.slice()
      const cached = engine.getPeaks(1, 10)
      engine.removeTrack(0)
      expect(engine.getState().canRestoreTrack).toBe(true)
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.4)
      expect(engine.getState().tracks[0]).toMatchObject({ name: 'Faixa 1', source: 'ocarina', volume: 0.6, delay: 0.3, canUndo: true })
      expect(engine.getState().tracks[1].name).toBe('Faixa 2')
      expect(engine.getState().tracks[0].revision).toBeGreaterThan(previous[0].revision)
      expect(engine.getState().tracks[1].revision).toBeGreaterThan(previous[1].revision)
      expect(engine.getPeaks(0, 10)).toBe(cached)
      expect(engine.getState().tracks[2]).toMatchObject({ name: 'Faixa 3', status: 'empty', source: 'mic', canUndo: false })
      engine.restoreTrack()
      expect(engine.getState().canRestoreTrack).toBe(false)
      expect(engine.getState().tracks[0]).toMatchObject({ name: 'Flauta', source: 'ocarina', pan: 0.4 })
      expect(engine.getState().tracks[1].name).toBe('Faixa 2')
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.2)
      expect(engine.getTakeAudio(1)!.samples[0]).toBeCloseTo(0.4)
      engine.undo(0)
      engine.undo(1)
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.1)
      expect(engine.getTakeAudio(1)!.samples[0]).toBeCloseTo(0.3)
      expect(engine.getState().tracks[0].source).toBe('mic')
      expect(engine.getState().tracks[1].source).toBe('mic')
    })

    it('nao restaura sobre ultimo slot ocupado e mantem a possibilidade de restaurar', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2))
      engine.removeTrack(0)
      engine.applyTake(1, Float32Array.of(0.7))
      const before = engine.getState()
      engine.restoreTrack()
      expect(engine.getState()).toBe(before)
      expect(engine.getState().canRestoreTrack).toBe(true)
      engine.clear(1)
      engine.restoreTrack()
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.2)
    })

    it('invalida restore quando BPM ou compassos mudam (take removido teria outra duracao)', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2))
      engine.removeTrack(0)
      expect(engine.getState().canRestoreTrack).toBe(true)
      expect(engine.setBpm(engine.getState().bpm + 10)).toBe(true)
      expect(engine.getState().canRestoreTrack).toBe(false)
      engine.restoreTrack()
      expect(engine.getState().tracks[0].status).toBe('empty')
    })

    it.each(['clearAll', 'importProject', 'dispose'] as const)('invalida restore ao chamar %s', async (action) => {
      await engine.init()
      engine.removeTrack(0)
      if (action === 'importProject') engine.importProject(engine.exportProject())
      else engine[action]()
      expect(engine.getState().canRestoreTrack).toBe(false)
      const before = engine.getState()
      engine.restoreTrack()
      expect(engine.getState()).toBe(before)
    })

    it('bloqueia qualquer remocao e restore enquanto outra faixa esta armed ou recording', async () => {
      await engine.init()
      engine.removeTrack(0)
      engine.setTrack(1, { source: 'ocarina' })
      engine.record(1)
      let before = engine.getState()
      engine.removeTrack(0)
      engine.restoreTrack()
      engine.removeTrack(2)
      expect(engine.getState()).toBe(before)
      TestContext.instances[0].currentTime = 3
      vi.advanceTimersByTime(25)
      before = engine.getState()
      engine.removeTrack(0)
      engine.restoreTrack()
      expect(engine.getState()).toBe(before)
    })

    it('ignora remocao e restore durante calibracao', async () => {
      await engine.init()
      engine.removeTrack(0)
      getUserMedia.mockResolvedValue(micStream().stream)
      const calibration = engine.calibrateLatency({ clicks: 2 })
      await engine.ensureMic()
      await Promise.resolve()
      const before = engine.getState()
      engine.removeTrack(0)
      engine.restoreTrack()
      expect(engine.getState()).toBe(before)
      await vi.runAllTimersAsync()
      expect(await calibration).toBeNull()
    })

    it('reinicia fontes deslocadas em fase e preserva a bateria', async () => {
      await engine.init()
      engine.applyTake(1, Float32Array.of(0.5))
      engine.setPattern([[true]])
      engine.play()
      const ctx = TestContext.instances[0]
      ctx.currentTime = 0.5
      const drums = engine.getState().tracks[2]
      const pattern = engine.getState().pattern
      engine.removeTrack(0)
      expect(ctx.bufferSources.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(0.52)
      expect(ctx.bufferSources.at(-1)!.start.mock.calls[0][1]).toBeCloseTo(0.47)
      expect(engine.getState().playing).toBe(true)
      expect(engine.getState().tracks[2]).toBe(drums)
      expect(engine.getState().pattern).toBe(pattern)
    })
  })

  describe('isolamento na monitoracao', () => {
    it('silencia outros canais ao armar e restaura ao cancelar sem alterar mute/solo', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina', volume: 0.6 })
      engine.setTrack(1, { volume: 0.4 })
      const params = engine.exportProject().tracks
      const ctx = TestContext.instances[0]
      const outs = [ctx.gains[2].gain, ctx.gains[5].gain, ctx.gains[8].gain]
      expect(engine.getState().isolateRecording).toBe(false)
      engine.setIsolateRecording(true)
      engine.record(0)
      expect(outs[0].setTargetAtTime).toHaveBeenLastCalledWith(0.6, 0, 0.01)
      expect(outs[1].setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.01)
      expect(outs[2].setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.01)
      expect(engine.exportProject().tracks.map((t) => [t.muted, t.solo])).toEqual(params.map((t) => [t.muted, t.solo]))
      engine.record(0)
      expect(outs[1].setTargetAtTime).toHaveBeenLastCalledWith(0.4, 0, 0.01)
      expect(outs[2].setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0, 0.01)
    })

    it('atualiza a monitoracao ao ligar/desligar durante recording e restaura apos take vazio', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.record(0)
      const ctx = TestContext.instances[0]
      const out = ctx.gains[5].gain
      ctx.currentTime = 3
      vi.advanceTimersByTime(25)
      expect(engine.getState().tracks[0].status).toBe('recording')
      engine.setIsolateRecording(true)
      expect(out.setTargetAtTime).toHaveBeenLastCalledWith(0, 3, 0.01)
      engine.setIsolateRecording(false)
      expect(out.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 3, 0.01)
      engine.setIsolateRecording(true)
      ctx.currentTime = 8
      await vi.advanceTimersByTimeAsync(25)
      expect(engine.getState().tracks[0].silentTake).toBe(true)
      expect(out.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 8, 0.01)
    })

    it('renderMix ignora isolamento e export nao inclui flag de monitoracao', async () => {
      await engine.init()
      class Offline extends TestContext {
        channels: number
        length: number
        constructor(channels: number, length: number, rate: number) {
          super()
          this.channels = channels
          this.length = length
          this.sampleRate = rate
        }
        async startRendering() { return new TestBuffer({ numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate }) }
      }
      vi.stubGlobal('OfflineAudioContext', Offline)
      engine.setTrack(0, { source: 'ocarina' })
      engine.setIsolateRecording(true)
      engine.record(0)
      await engine.renderMix(1)
      const offline = TestContext.instances.at(-1)!
      expect(offline.gains[5].gain.value).toBe(0.8)
      expect(offline.gains[8].gain.value).toBe(0.8)
      expect(engine.exportProject()).not.toHaveProperty('isolateRecording')
    })
  })

  describe('audio do take', () => {
    it('aplica reverb 0.2 a ocarina seca e preserva reverb ja escolhido', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina' })
      expect(engine.getState().tracks[0].reverb).toBe(0.2)
      engine.setTrack(0, { reverb: 0.6 })
      engine.applyTake(0, Float32Array.of(0.3), { source: 'ocarina' })
      expect(engine.getState().tracks[0].reverb).toBe(0.6)
      engine.applyTake(1, Float32Array.of(0.2), { source: 'mic' })
      expect(engine.getState().tracks[1].reverb).toBe(0)
    })

    it.each(INSTRUMENTS)('default de reverb para %s ao trocar source e aplicar take', async (instrument) => {
      await engine.init()
      const expected = { ocarina: 0.2, flute: 0.2, kalimba: 0.15, bass: 0, cavaquinho: 0.12 }[instrument]
      engine.setTrack(0, { source: instrument })
      expect(engine.getState().tracks[0].reverb).toBe(expected)
      engine.applyTake(1, Float32Array.of(0.2), { source: instrument })
      expect(engine.getState().tracks[1].reverb).toBe(expected)
      engine.setTrack(0, { reverb: 0.6 })
      engine.setTrack(0, { source: 'mic' })
      engine.setTrack(0, { source: instrument })
      expect(engine.getState().tracks[0].reverb).toBe(0.6)
    })

    it('import invalido volta para mic e preserva instrumentos conhecidos', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'bass' })
      const project = engine.exportProject()
      Object.assign(project.tracks[0], { source: 'desconhecido' })
      project.tracks[1].source = 'flute'
      Object.assign(project.tracks[1], { reverb: 0 })
      engine.importProject(project)
      expect(engine.getState().tracks[0].source).toBe('mic')
      expect(engine.getState().tracks[1].source).toBe('flute')
      expect(engine.getState().tracks[1].reverb).toBe(0)
    })

    it('undo individual restaura reverb anterior do take e do slot vazio', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2))
      engine.applyTake(0, Float32Array.of(0.5), { source: 'ocarina' })
      expect(engine.getState().tracks[0].reverb).toBe(0.2)
      engine.undo(0)
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'mic', reverb: 0 })
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.2)
      engine.applyBatch({ takes: [{ track: 1, samples: Float32Array.of(0.6), source: 'kalimba' }] })
      expect(engine.getState().tracks[1].reverb).toBe(0.15)
      engine.undoBatch()
      expect(engine.getState().tracks[1]).toMatchObject({ status: 'empty', source: 'mic', reverb: 0 })
    })

    it('retorna copias independentes e o sampleRate original do buffer', async () => {
      await engine.init()
      const project = engine.exportProject()
      project.sampleRate = 48000
      project.tracks[0].audio = Float32Array.of(0.2, 0.4)
      engine.importProject(project)
      const first = engine.getTakeAudio(0)!
      expect(first.sampleRate).toBe(48000)
      first.samples[0] = 9
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.2)
      expect(engine.getTakeAudio(0)!.samples).not.toBe(first.samples)
      expect(engine.getTakeAudio(1)).toBeNull()
      expect(engine.getTakeAudio(2)).toBeNull()
      expect(engine.getTakeAudio(-1)).toBeNull()
    })

    it('completa com zeros e corta sem esticar o audio, preservando a copia de entrada', async () => {
      await engine.init()
      const length = Math.ceil(engine.getState().loopDuration * 100)
      const samples = Float32Array.of(0.2, 0.4)
      engine.applyTake(0, samples)
      samples[0] = 9
      const first = engine.getTakeAudio(0)!
      expect(first.sampleRate).toBe(100)
      expect(first.samples.length).toBe(length)
      expect(Array.from(first.samples.slice(0, 4))).toEqual(Array.from(Float32Array.of(0.2, 0.4, 0, 0)))
      engine.applyTake(0, new Float32Array(length + 10).fill(0.5))
      expect(engine.getTakeAudio(0)!.samples).toEqual(new Float32Array(length).fill(0.5))
    })

    it('reamostra pela taxa antes de completar o restante com zeros', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0, 1), { sampleRate: 50 })
      expect(Array.from(engine.getTakeAudio(0)!.samples.slice(0, 6))).toEqual([0, 0.5, 1, 1, 0, 0])
      engine.applyTake(0, Float32Array.of(0, 0.25, 0.5, 0.75, 1), { sampleRate: 200 })
      expect(Array.from(engine.getTakeAudio(0)!.samples.slice(0, 5))).toEqual([0, 0.5, 1, 0, 0])
    })

    it('undo restaura audio e source anteriores inclusive faixa vazia', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina' })
      engine.undo(0)
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'mic', reverb: 0, status: 'empty', canUndo: false })
      expect(engine.getTakeAudio(0)).toBeNull()
      engine.applyTake(0, Float32Array.of(0.3))
      const previous = engine.getTakeAudio(0)!
      const revision = engine.getState().tracks[0].revision
      engine.applyTake(0, Float32Array.of(0.7), { source: 'ocarina' })
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'ocarina', silentTake: false, canUndo: true, revision: revision + 1 })
      engine.undo(0)
      expect(engine.getTakeAudio(0)).toEqual(previous)
      expect(engine.getState().tracks[0].source).toBe('mic')
    })

    it('clear substitui o snapshot de source e audio corretamente', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina' })
      const previous = engine.getTakeAudio(0)
      engine.clear(0)
      engine.setTrack(0, { source: 'mic' })
      engine.undo(0)
      expect(engine.getTakeAudio(0)).toEqual(previous)
      expect(engine.getState().tracks[0].source).toBe('ocarina')
    })

    it('reinicia a fonte em fase quando o transporte esta tocando', async () => {
      await engine.init()
      engine.setMetronome(false)
      engine.play()
      const ctx = TestContext.instances[0]
      ctx.currentTime = 0.5
      engine.applyTake(0, Float32Array.of(0.2))
      const source = ctx.bufferSources.at(-1)!
      expect(source.start.mock.calls[0][0]).toBeCloseTo(0.52)
      expect(source.start.mock.calls[0][1]).toBeCloseTo(0.47)
      expect(engine.getState().playing).toBe(true)
    })

    it('ignora apply e leitura de take em armed/recording e no drums', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.record(0)
      const armed = engine.getState()
      engine.applyTake(0, Float32Array.of(1), { source: 'mic' })
      expect(engine.getState()).toBe(armed)
      expect(engine.getTakeAudio(0)).toBeNull()
      TestContext.instances[0].currentTime = 3
      vi.advanceTimersByTime(25)
      expect(engine.getState().tracks[0].status).toBe('recording')
      const recording = engine.getState()
      engine.applyTake(0, Float32Array.of(1))
      engine.applyTake(2, Float32Array.of(1))
      expect(engine.getState()).toBe(recording)
      expect(engine.getTakeAudio(0)).toBeNull()
    })

    it('ignora durante calibracao', async () => {
      await engine.init()
      getUserMedia.mockResolvedValue(micStream().stream)
      const calibration = engine.calibrateLatency({ clicks: 2 })
      await engine.ensureMic()
      await Promise.resolve()
      const previous = engine.getState()
      engine.applyTake(0, Float32Array.of(1))
      expect(engine.getState()).toBe(previous)
      expect(engine.getTakeAudio(0)).toBeNull()
      await vi.runAllTimersAsync()
      expect(await calibration).toBeNull()
    })
  })

  describe('ocarina', () => {
    let voices: MockInstance<typeof synth.startVoice>
    let rendered: MockInstance<typeof synth.renderNotes>
    let endVoices: (() => void)[]
    beforeEach(() => {
      endVoices = []
      voices = vi.spyOn(synth, 'startVoice').mockImplementation(() => {
        let ended = () => {}
        endVoices.push(() => ended())
        return { stop: vi.fn(), onEnded: (callback) => { ended = callback } }
      })
      rendered = vi.spyOn(synth, 'renderNotes').mockImplementation(async (notes, duration, sampleRate) => {
        const buffer = new TestBuffer({ numberOfChannels: 1, length: Math.ceil(duration * sampleRate), sampleRate })
        if (notes.length) buffer.getChannelData(0).fill(0.2)
        return buffer as unknown as AudioBuffer
      })
    })
    async function arm() {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.record(0)
      const ctx = TestContext.instances[0]
      const start = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      return { ctx, start, duration: engine.getState().loopDuration }
    }
    async function finishTake(ctx: TestContext, start: number, duration: number) {
      ctx.currentTime = start + duration + 0.021
      await vi.advanceTimersByTimeAsync(25)
    }

    it('preview cromatico usa contexto/mixer do canal e release apos 250ms', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'flute' })
      engine.previewNote(0, 61)
      engine.noteOn(0, 0)
      expect(TestContext.instances).toHaveLength(1)
      expect(voices.mock.calls[0][2]).toBe(61)
      expect(voices.mock.calls[0][4]).toBe('flute')
      expect(voices.mock.calls[0][1]).toBe(voices.mock.calls[1][1])
      vi.advanceTimersByTime(249)
      expect(voices.mock.results[0].value.stop).not.toHaveBeenCalled()
      TestContext.instances[0].currentTime = 0.25
      vi.advanceTimersByTime(1)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledExactlyOnceWith(0.25, 0.06)
      expect(getUserMedia).not.toHaveBeenCalled()
    })

    it.each(['stop', 'source'] as const)('preview da kalimba permite corte antecipado por %s', async (action) => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      engine.previewNote(0, 61, 1)
      if (action === 'stop') engine.stop()
      else engine.setTrack(0, { source: 'bass' })
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledExactlyOnceWith(0, 0.06)
      vi.advanceTimersByTime(1000)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })

    it('preview conta na polifonia e fim natural cancela timer', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      for (let i = 0; i < 5; i++) engine.previewNote(0, 60 + i)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledExactlyOnceWith(0, 0.06)
      endVoices[1]()
      vi.advanceTimersByTime(250)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
      expect(voices.mock.results[1].value.stop).not.toHaveBeenCalled()
    })

    it.each(['armed', 'recording'] as const)('preview em %s nao entra em held nem no take', async (status) => {
      const { ctx, start, duration } = await arm()
      if (status === 'recording') { ctx.currentTime = start + 0.22; vi.advanceTimersByTime(25) }
      engine.previewNote(0, 61)
      await finishTake(ctx, start, duration)
      expect(rendered).not.toHaveBeenCalled()
      expect(engine.getState().tracks[0]).toMatchObject({ notes: null, silentTake: true })
    })

    it('preview ignora mic/drums/MIDI invalido e respeita duracao explicita', async () => {
      await engine.init()
      engine.previewNote(0, 60)
      engine.previewNote(2, 60)
      engine.setTrack(0, { source: 'ocarina' })
      for (const midi of [NaN, Infinity, -1, 128, 60.5]) engine.previewNote(0, midi)
      expect(voices).not.toHaveBeenCalled()
      engine.previewNote(0, 63, 0.1)
      TestContext.instances[0].currentTime = 0.1
      vi.advanceTimersByTime(100)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledExactlyOnceWith(0.1, 0.06)
    })

    it('padMode default notes e ignorado no mic; acorde toca e solta tres vozes', async () => {
      await engine.init()
      expect(engine.getState().tracks[0].padMode).toBe('notes')
      engine.setTrack(0, { padMode: 'chords' })
      expect(engine.getState().tracks[0].padMode).toBe('notes')
      engine.setTrack(0, { source: 'ocarina', padMode: 'chords' })
      engine.noteOn(0, 0)
      engine.noteOn(0, 4)
      expect(voices.mock.calls.map((call) => call[2])).toEqual([60, 64, 67])
      expect(new Set(voices.mock.calls.map((call) => call[3])).size).toBe(1)
      engine.noteOff(0, 0)
      for (const result of voices.mock.results) expect(result.value.stop).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('roubo corta o grupo inteiro mais antigo, incluindo caudas soltas', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba', padMode: 'chords' })
      engine.noteOn(0, 0)
      engine.noteOff(0, 0)
      engine.noteOn(0, 1)
      expect(voices).toHaveBeenCalledTimes(6)
      for (const result of voices.mock.results.slice(0, 3)) expect(result.value.stop).toHaveBeenLastCalledWith(0, 0.06)
      for (const result of voices.mock.results.slice(3)) expect(result.value.stop).not.toHaveBeenCalled()
      engine.noteOn(0, 2)
      for (const result of voices.mock.results.slice(3, 6)) expect(result.value.stop).toHaveBeenCalledExactlyOnceWith(0, 0.06)
    })

    it('acorde gravado gera tres GridNotes com inicio e duracao iguais', async () => {
      const { ctx, start, duration } = await arm()
      engine.setTrack(0, { padMode: 'chords' })
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      ctx.currentTime = start + 0.82
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      const notes = engine.getState().tracks[0].notes!
      expect(notes.map((note) => note.midi)).toEqual([60, 64, 67])
      for (const note of notes) {
        expect(note.step).toBeCloseTo(0.2 / 0.15)
        expect(note.length).toBeCloseTo(0.6 / 0.15)
      }
      expect(rendered.mock.calls[0][0]).toHaveLength(3)
    })

    it.each(['mode', 'key', 'scale'] as const)('troca de %s corta todo o acorde sem mudar take', async (action) => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.3), { source: 'ocarina' })
      engine.setTrack(0, { padMode: 'chords' })
      const audio = engine.getTakeAudio(0)
      engine.noteOn(0, 0)
      if (action === 'mode') engine.setTrack(0, { padMode: 'notes' })
      else if (action === 'key') engine.setKey('D')
      else engine.setScale('major')
      for (const result of voices.mock.results) expect(result.value.stop).toHaveBeenCalledExactlyOnceWith(0, 0.06)
      expect(engine.getTakeAudio(0)).toEqual(audio)
    })

    it('export/import preservam padMode e projeto antigo ou invalido usa notes', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina', padMode: 'chords' })
      const project = engine.exportProject()
      expect(project.tracks[0].padMode).toBe('chords')
      engine.setTrack(0, { padMode: 'notes' })
      engine.importProject(project)
      expect(engine.getState().tracks[0].padMode).toBe('chords')
      delete project.tracks[0].padMode
      engine.importProject(project)
      expect(engine.getState().tracks[0].padMode).toBe('notes')
      Object.assign(project.tracks[0], { padMode: 'invalido' })
      engine.importProject(project)
      expect(engine.getState().tracks[0].padMode).toBe('notes')
    })

    it('grade renderiza steps em segundos, guarda copia e undo restaura notas', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      const previous = [{ step: 0, length: 1, midi: 60 }]
      engine.applyTake(0, Float32Array.of(0.7), { notes: previous })
      const notes = [{ step: 2, length: 3, midi: 65 }]
      expect(await engine.setTrackNotes(0, notes)).toBe(true)
      expect(rendered.mock.calls[0][0]).toEqual([{ time: 0.3, duration: 0.44999999999999996, midi: 65 }])
      expect(rendered.mock.calls[0][3]).toBe('ocarina')
      expect(engine.getState().tracks[0].notes).toEqual(notes)
      notes[0].midi = 90
      expect(engine.getState().tracks[0].notes![0].midi).toBe(65)
      expect(engine.setBpm(120)).toBe(false)
      engine.undo(0)
      expect(engine.getState().tracks[0].notes).toEqual(previous)
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.7)
    })

    it('ultimo pedido da grade vence mesmo resolvendo antes do primeiro', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      const old = [{ step: 0, length: 1, midi: 60 }]
      engine.applyTake(0, Float32Array.of(0.6), { notes: old })
      const first = deferred<AudioBuffer>()
      const last = deferred<AudioBuffer>()
      rendered.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
      const p1 = engine.setTrackNotes(0, [{ step: 1, length: 1, midi: 62 }])
      const latest = [{ step: 3, length: 2, midi: 67 }]
      const p2 = engine.setTrackNotes(0, latest)
      const buffer = new TestBuffer({ numberOfChannels: 1, length: 480, sampleRate: 100 }) as unknown as AudioBuffer
      last.resolve(buffer)
      expect(await p2).toBe(true)
      first.resolve(buffer)
      expect(await p1).toBe(false)
      expect(engine.getState().tracks[0].notes).toEqual(latest)
      engine.undo(0)
      expect(engine.getState().tracks[0].notes).toEqual(old)
      expect(engine.getTakeAudio(0)!.samples[0]).toBeCloseTo(0.6)
    })

    it('lista vazia limpa audio/notas, mantem source e pode ser desfeita', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'flute' })
      const notes = [{ step: 1, length: 2, midi: 74 }]
      engine.applyTake(0, Float32Array.of(0.3), { notes })
      expect(await engine.setTrackNotes(0, [])).toBe(true)
      expect(rendered).not.toHaveBeenCalled()
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'empty', source: 'flute', notes: null, canUndo: true })
      expect(engine.getTakeAudio(0)).toBeNull()
      engine.undo(0)
      expect(engine.getState().tracks[0].notes).toEqual(notes)
    })

    it('render pendente nao sobrepoe limpeza nem troca de fonte com ida e volta', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      const first = deferred<AudioBuffer>()
      rendered.mockReturnValueOnce(first.promise)
      const pending = engine.setTrackNotes(0, [{ step: 0, length: 1, midi: 60 }])
      engine.setTrack(0, { source: 'flute' })
      engine.setTrack(0, { source: 'ocarina' })
      first.resolve(new TestBuffer({ numberOfChannels: 1, length: 480, sampleRate: 100 }) as unknown as AudioBuffer)
      expect(await pending).toBe(false)
      const second = deferred<AudioBuffer>()
      rendered.mockReturnValueOnce(second.promise)
      const p2 = engine.setTrackNotes(0, [{ step: 0, length: 1, midi: 60 }])
      await engine.setTrackNotes(0, [])
      second.resolve(new TestBuffer({ numberOfChannels: 1, length: 480, sampleRate: 100 }) as unknown as AudioBuffer)
      expect(await p2).toBe(false)
      expect(engine.getState().tracks[0].notes).toBeNull()
      expect(engine.getTakeAudio(0)).toBeNull()
    })

    it('recusa mic/drums/armed e falha de render sem alterar take', async () => {
      await engine.init()
      const notes = [{ step: 0, length: 1, midi: 60 }]
      expect(await engine.setTrackNotes(0, notes)).toBe(false)
      expect(await engine.setTrackNotes(2, notes)).toBe(false)
      engine.setTrack(0, { source: 'ocarina' })
      engine.record(0)
      expect(await engine.setTrackNotes(0, notes)).toBe(false)
      engine.stop()
      engine.applyTake(0, Float32Array.of(0.5), { notes })
      const before = engine.getState()
      rendered.mockRejectedValueOnce(new Error('render indisponivel'))
      expect(await engine.setTrackNotes(0, [{ step: 1, length: 1, midi: 62 }])).toBe(false)
      expect(engine.getState()).toBe(before)
    })

    it('applyBatch/undoBatch e remove/restore preservam notas; apply sem notes zera metadados', async () => {
      await engine.init()
      const original = [{ step: 0, length: 1, midi: 60 }]
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina', notes: original })
      const changed = [{ step: 2, length: 2, midi: 64 }]
      engine.applyBatch({ takes: [{ track: 0, samples: Float32Array.of(0.4), source: 'kalimba', notes: changed }] })
      expect(engine.getState().tracks[0].notes).toEqual(changed)
      engine.undoBatch()
      expect(engine.getState().tracks[0].notes).toEqual(original)
      engine.removeTrack(0)
      expect(engine.getState().tracks[1].notes).toBeNull()
      engine.restoreTrack()
      expect(engine.getState().tracks[0].notes).toEqual(original)
      engine.applyTake(0, Float32Array.of(0.5))
      expect(engine.getState().tracks[0].notes).toBeNull()
      engine.undo(0)
      expect(engine.getState().tracks[0].notes).toEqual(original)
      engine.clearAll()
      expect(engine.getState().tracks.every((track) => track.notes === null)).toBe(true)
    })

    it('exporta notas independentes e importa somente notas validas de instrumento', async () => {
      await engine.init()
      const notes = [{ step: 0.5, length: 1.5, midi: 65 }]
      engine.applyTake(0, Float32Array.of(0.3), { source: 'ocarina', notes })
      const data = engine.exportProject()
      Object.assign(data.tracks[0].notes![0], { midi: 99 })
      expect(engine.getState().tracks[0].notes).toEqual(notes)
      Object.assign(data.tracks[0], { notes: [...notes, { step: NaN, length: 1, midi: 60 }, { step: 1, length: 0, midi: 60 }, { step: 1, length: 1, midi: Infinity }, null] })
      Object.assign(data.tracks[1], { audio: Float32Array.of(0.2), source: 'mic', notes })
      engine.importProject(data)
      expect(engine.getState().tracks[0].notes).toEqual(notes)
      expect(engine.getState().tracks[1].notes).toBeNull()
      delete data.tracks[0].notes
      engine.importProject(data)
      expect(engine.getState().tracks[0].notes).toBeNull()
    })

    it.each(['stop', 'source', 'remove', 'dispose'] as const)('corta cauda solta da kalimba com %s', async (action) => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      engine.noteOn(0, 0)
      engine.noteOff(0, 0)
      const voice = voices.mock.results[0].value
      expect(voice.stop).toHaveBeenCalledWith(0)
      if (action === 'stop') engine.stop()
      else if (action === 'source') engine.setTrack(0, { source: 'ocarina' })
      else if (action === 'remove') engine.removeTrack(0)
      else engine.dispose()
      expect(voice.stop).toHaveBeenLastCalledWith(0, 0.06)
    })

    it('conta caudas soltas ao roubar a quinta e a sexta voz', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      for (let i = 0; i < 6; i++) {
        engine.noteOn(0, 0)
        engine.noteOff(0, 0)
      }
      expect(voices.mock.results[0].value.stop).toHaveBeenLastCalledWith(0, 0.06)
      expect(voices.mock.results[1].value.stop).toHaveBeenLastCalledWith(0, 0.06)
      expect(voices.mock.results[2].value.stop).toHaveBeenCalledTimes(1)
      endVoices[2]()
      engine.noteOn(0, 1)
      expect(voices.mock.results[3].value.stop).toHaveBeenCalledTimes(1)
    })

    it('nao recaptura kalimba terminada naturalmente com tecla ainda pressionada', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      engine.record(0)
      const ctx = TestContext.instances[0]
      const start = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      engine.noteOn(0, 0)
      ctx.currentTime = 1.51
      endVoices[0]()
      await finishTake(ctx, start, engine.getState().loopDuration)
      expect(rendered).not.toHaveBeenCalled()
      expect(engine.getState().tracks[0].silentTake).toBe(true)
    })

    it('fechamento do take corta tambem cauda cuja tecla foi solta', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'kalimba' })
      engine.record(0)
      const ctx = TestContext.instances[0]
      const start = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      engine.noteOff(0, 0)
      await finishTake(ctx, start, engine.getState().loopDuration)
      expect(voices.mock.results[0].value.stop).toHaveBeenLastCalledWith(ctx.currentTime, 0.06)
      expect(engine.getState().tracks[0].status).toBe('recorded')
    })

    it('fim de voz antiga nao solta outra nota na mesma tecla; ocarina continua capturavel', async () => {
      const { ctx, start, duration } = await arm()
      engine.noteOn(0, 0)
      engine.noteOff(0, 0)
      engine.noteOn(0, 0)
      endVoices[0]()
      ctx.currentTime = start + 0.22
      vi.advanceTimersByTime(25)
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      expect(rendered.mock.calls[0][0]).toHaveLength(1)
      expect(rendered.mock.calls[0][0][0]).toMatchObject({ time: 0, midi: 60 })
    })

    it('escala maior em C inclui Fa4 e Mi5; pentatonica ignora grau 8', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      expect(engine.getState().scale).toBe('pentatonic')
      engine.noteOn(0, 8)
      expect(voices).not.toHaveBeenCalled()
      engine.setScale('major')
      engine.noteOn(0, 3)
      engine.noteOn(0, 9)
      engine.noteOn(0, 10)
      expect(voices.mock.calls.map((call) => call[2])).toEqual([65, 76])
    })

    it('trocar escala corta vozes com rampa, notifica e preserva take', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2), { source: 'ocarina' })
      const audio = engine.getTakeAudio(0)
      engine.noteOn(0, 0)
      const changed = vi.fn()
      const unsubscribe = engine.subscribe(changed)
      engine.setScale('major')
      expect(voices.mock.results[0].value.stop).toHaveBeenLastCalledWith(0, 0.06)
      expect(changed).toHaveBeenCalledTimes(1)
      expect(engine.getTakeAudio(0)).toEqual(audio)
      engine.setScale('major')
      expect(changed).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('exporta escala e importa escala salva, antiga ou invalida', async () => {
      await engine.init()
      engine.setScale('major')
      const project = engine.exportProject()
      expect(project.scale).toBe('major')
      engine.setScale('pentatonic')
      engine.importProject(project)
      expect(engine.getState().scale).toBe('major')
      delete project.scale
      engine.importProject(project)
      expect(engine.getState().scale).toBe('pentatonic')
      engine.setScale('major')
      Object.assign(project, { scale: 'invalida' })
      engine.importProject(project)
      expect(engine.getState().scale).toBe('pentatonic')
    })

    it.each(INSTRUMENTS)('pads usam oitava e timbre de %s', async (instrument) => {
      await engine.init()
      engine.setTrack(0, { source: instrument })
      engine.noteOn(0, 0)
      const expected = { ocarina: 60, flute: 72, kalimba: 60, bass: 36, cavaquinho: 60 }[instrument]
      expect(voices.mock.calls[0][2]).toBe(expected)
      expect(voices.mock.calls[0][4]).toBe(instrument)
      engine.noteOff(0, 0)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalled()
      expect(getUserMedia).not.toHaveBeenCalled()
    })

    it.each(INSTRUMENTS)('renderiza o take com o timbre %s', async (instrument) => {
      await engine.init()
      engine.setTrack(0, { source: instrument })
      engine.record(0)
      const ctx = TestContext.instances[0]
      const start = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      await finishTake(ctx, start, engine.getState().loopDuration)
      expect(rendered.mock.calls[0][3]).toBe(instrument)
      expect(engine.getState().tracks[0]).toMatchObject({ source: instrument, status: 'recorded' })
    })

    it('trocar instrumento solta voz com rampa sem alterar take existente', async () => {
      await engine.init()
      engine.applyTake(0, Float32Array.of(0.2), { source: 'flute' })
      const audio = engine.getTakeAudio(0)
      engine.noteOn(0, 0)
      engine.setTrack(0, { source: 'kalimba' })
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledWith(0, 0.06)
      expect(engine.getTakeAudio(0)).toEqual(audio)
      engine.noteOn(0, 0)
      expect(voices.mock.calls[1][4]).toBe('kalimba')
    })

    it('removeTrack solta as vozes ao vivo', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.noteOn(0, 0)
      engine.removeTrack(0)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })

    it('toca pela faixa, respeita o tom e solta somente a nota pedida', async () => {
      await engine.init()
      engine.noteOn(0, 0)
      expect(voices).not.toHaveBeenCalled()
      engine.setTrack(0, { source: 'ocarina', volume: 0.4, pan: 0.5, delay: 0.3 })
      engine.setKey('D')
      engine.noteOn(0, 0)
      engine.noteOn(0, 1)
      expect(voices.mock.calls.map((call) => call[2])).toEqual([62, 64])
      expect(voices.mock.calls[0][1]).toBe(voices.mock.calls[1][1])
      engine.noteOff(0, 7)
      expect(voices.mock.results[0].value.stop).not.toHaveBeenCalled()
      engine.noteOff(0, 0)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledWith(0)
      expect(voices.mock.results[1].value.stop).not.toHaveBeenCalled()
      expect(getUserMedia).not.toHaveBeenCalled()
    })

    it('limita a quatro vozes por canal, cortando a mais antiga', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.setTrack(1, { source: 'ocarina' })
      for (let degree = 0; degree < 5; degree++) engine.noteOn(0, degree)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
      expect(voices.mock.results[1].value.stop).not.toHaveBeenCalled()
      engine.noteOn(1, 0)
      engine.noteOff(0, 0)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
      engine.stop()
      for (const result of voices.mock.results) expect(result.value.stop).toHaveBeenCalledTimes(1)
    })

    it('grava eventos no tempo ouvido, sem mic nem compensacao de entrada', async () => {
      engine.setLatencyOffset(200)
      const { ctx, start, duration } = await arm()
      engine.setLatencyOffset(200)
      ctx.currentTime = start + 0.01
      engine.noteOn(0, 7)
      expect(engine.getState().tracks[0].status).toBe('armed')
      engine.noteOff(0, 7)
      ctx.currentTime = start + 0.27
      engine.noteOn(0, 0)
      expect(engine.getState().tracks[0].status).toBe('recording')
      ctx.currentTime = start + 0.77
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      const note = rendered.mock.calls[0][0][0]
      expect(note.time).toBeCloseTo(0.25)
      expect(note.duration).toBeCloseTo(0.5)
      expect(note.midi).toBe(60)
      expect(engine.getState().tracks[0].notes![0].step).toBeCloseTo(0.25 / 0.15)
      expect(engine.getState().tracks[0].notes![0].length).toBeCloseTo(0.5 / 0.15)
      expect(engine.getState().tracks[0].notes![0].midi).toBe(60)
      expect(rendered.mock.calls[0][0]).toHaveLength(1)
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', canUndo: true, silentTake: false })
      expect(engine.exportProject().tracks[0].audio![0]).toBeCloseTo(0.2)
      expect(getUserMedia).not.toHaveBeenCalled()
      expect(TestWorklet.instances).toHaveLength(0)
      engine.undo(0)
      expect(engine.getState().tracks[0].status).toBe('empty')
    })

    it('envia toque de duracao zero ao render em vez de descartar como silencio', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      expect(rendered).toHaveBeenCalledTimes(1)
      expect(rendered.mock.calls[0][0][0].duration).toBe(0)
      expect(engine.getState().tracks[0].notes![0].length).toBeGreaterThan(0)
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', silentTake: false })
    })

    it('captura em time zero a nota segurada no armed e solta no meio, preservando o MIDI original', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start - 0.1
      engine.noteOn(0, 0)
      expect(engine.getState().tracks[0].status).toBe('armed')
      engine.setKey('C')
      ctx.currentTime = start + 0.22
      vi.advanceTimersByTime(25)
      expect(engine.getState().tracks[0].status).toBe('recording')
      ctx.currentTime = start + 1.02
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      expect(rendered.mock.calls[0][0]).toHaveLength(1)
      expect(rendered.mock.calls[0][0][0]).toMatchObject({ time: 0, midi: 60 })
      expect(rendered.mock.calls[0][0][0].duration).toBeCloseTo(1)
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', silentTake: false })
    })

    it('captura nota da contagem mantida ate o fechamento mesmo com tick atrasado', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start - 0.5
      engine.noteOn(0, 2)
      expect(engine.getState().tracks[0].status).toBe('armed')
      await finishTake(ctx, start, duration)
      expect(rendered.mock.calls[0][0]).toEqual([{ time: 0, duration, midi: 64 }])
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', silentTake: false })
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })

    it('fecha a nota segurada na borda do loop', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start + 0.52
      engine.noteOn(0, 2)
      await finishTake(ctx, start, duration)
      expect(rendered.mock.calls[0][0][0].duration).toBeCloseTo(duration - 0.5)
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })

    it('take sem notas restaura o audio anterior e o undo', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      ctx.currentTime = start + 0.52
      engine.noteOff(0, 0)
      await finishTake(ctx, start, duration)
      const previous = engine.exportProject().tracks[0].audio
      const canUndo = engine.getState().tracks[0].canUndo
      engine.record(0)
      const nextStart = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      await finishTake(ctx, nextStart, duration)
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', silentTake: true, canUndo })
      expect(engine.exportProject().tracks[0].audio).toEqual(previous)
      expect(rendered).toHaveBeenCalledTimes(1)
    })

    it('overdub mistura a camada nova e undo restaura o take', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      await finishTake(ctx, start, duration)
      const previous = engine.exportProject().tracks[0].audio
      engine.setTrack(0, { overdubbing: true })
      engine.record(0)
      const nextStart = ctx.currentTime - 0.02 + engine.getArmedIn(0)!
      ctx.currentTime = nextStart + 0.22
      engine.noteOn(0, 1)
      await finishTake(ctx, nextStart, duration)
      expect(engine.exportProject().tracks[0].audio![0]).toBeCloseTo(0.4)
      engine.undo(0)
      expect(engine.exportProject().tracks[0].audio).toEqual(previous)
    })

    it('encerra a nota roubada no evento correto ao exceder a polifonia', async () => {
      const { ctx, start, duration } = await arm()
      for (let degree = 0; degree < 5; degree++) {
        ctx.currentTime = start + 0.22 + degree * 0.1
        engine.noteOn(0, degree)
      }
      await finishTake(ctx, start, duration)
      expect(rendered.mock.calls[0][0]).toHaveLength(5)
      expect(rendered.mock.calls[0][0][0].duration).toBeCloseTo(0.4)
    })

    it('worklet e desconexao do mic nao interferem no take de instrumento', async () => {
      const { ctx, start, duration } = await arm()
      const mic = micStream()
      getUserMedia.mockResolvedValue(mic.stream)
      await engine.ensureMic()
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      const onmessage = TestWorklet.instances[0].port.onmessage as unknown as (event: { data: { frame: number; data: Float32Array } }) => void
      onmessage({ data: { frame: 10000, data: new Float32Array(128) } })
      expect(engine.getState().tracks[0].status).toBe('recording')
      mic.track.onended!()
      expect(engine.getState().tracks[0].status).toBe('recording')
      await finishTake(ctx, start, duration)
      expect(engine.getState().tracks[0].status).toBe('recorded')
    })

    it('troca de source durante armed cancela e solta as vozes', async () => {
      await arm()
      engine.noteOn(0, 0)
      engine.setTrack(0, { source: 'mic' })
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'mic', status: 'empty' })
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })

    it('troca de source cancela captura e vozes sem aplicar render atrasado', async () => {
      const { ctx, start, duration } = await arm()
      const result = deferred<AudioBuffer>()
      rendered.mockReturnValueOnce(result.promise)
      ctx.currentTime = start + 0.22
      engine.noteOn(0, 0)
      await finishTake(ctx, start, duration)
      engine.setTrack(0, { source: 'mic' })
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'mic', status: 'empty' })
      expect(voices.mock.results[0].value.stop).toHaveBeenCalled()
      result.resolve(new TestBuffer({ numberOfChannels: 1, length: 480, sampleRate: 100 }) as unknown as AudioBuffer)
      await Promise.resolve()
      expect(engine.getState().tracks[0].status).toBe('empty')
      expect(engine.exportProject().tracks[0].audio).toBeNull()
    })

    it('exporta key/source e aplica defaults ao importar projeto antigo', async () => {
      await engine.init()
      engine.setKey('G')
      engine.setTrack(0, { source: 'ocarina' })
      const data = engine.exportProject()
      expect(data.key).toBe('G')
      expect(data.tracks[0].source).toBe('ocarina')
      delete data.key
      for (const track of data.tracks) delete track.source
      engine.importProject(data)
      expect(engine.getState().key).toBe('C')
      expect(engine.getState().tracks.every((track) => track.source === 'mic')).toBe(true)
    })

    it('dispose solta vozes mesmo sem transporte', async () => {
      await engine.init()
      engine.setTrack(0, { source: 'ocarina' })
      engine.noteOn(0, 0)
      engine.dispose()
      expect(voices.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
    })
  })

})
