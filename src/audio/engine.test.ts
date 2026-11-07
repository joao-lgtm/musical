import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from './engine'

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
  createBufferSource = audioNode
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
  })

  it('inicializa uma vez e toca bateria sem pedir captura', async () => {
    const first = engine.init()
    expect(engine.init()).toBe(first)
    await first
    expect(engine.getState()).toMatchObject({ status: 'ready', mic: 'off', micError: null, micTrack: null })
    engine.triggerDrum('kick')
    engine.toggleStep(0, 0)
    engine.play()
    expect(engine.getState().playing).toBe(true)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(TestContext.instances[0].audioWorklet.addModule).not.toHaveBeenCalled()
    expect(engine.getInputLevel()).toBe(0)
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
})
