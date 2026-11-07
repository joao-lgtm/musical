import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createEngine } from './engine'
import * as synth from './synth'
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
    engine.triggerDrum('kick')
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
      const expected = { ocarina: 0.2, flute: 0.2, kalimba: 0.15, bass: 0 }[instrument]
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
      expect(engine.getState().tracks[0]).toMatchObject({ source: 'mic', status: 'empty', canUndo: false })
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
      const expected = { ocarina: 60, flute: 72, kalimba: 60, bass: 36 }[instrument]
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
      expect(engine.getState().tracks[0]).toMatchObject({ status: 'recorded', silentTake: false })
    })

    it('captura em time zero a nota segurada no armed e solta no meio, preservando o MIDI original', async () => {
      const { ctx, start, duration } = await arm()
      ctx.currentTime = start - 0.1
      engine.noteOn(0, 0)
      expect(engine.getState().tracks[0].status).toBe('armed')
      engine.setKey('D')
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
