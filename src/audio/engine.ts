import type { CalibrationResult, DrumVoice, EngineState, LoopEngine, Position, ProjectData, TrackParams, TrackState } from './types'
import { DRUM_VOICES, STEPS_PER_BAR } from './types'
import {
  beatDuration,
  calibrationPlan,
  BEATS_PER_BAR,
  captureLatency,
  delayTime,
  filterFreq,
  heardTime,
  isAccent,
  loopDuration,
  nudgedOffset,
  overdubMix,
  positionAt,
  recordStart,
  renderWindow,
  fxTail,
  REVERB_SECONDS,
  DELAY_FEEDBACK,
  resample,
  resizePattern,
  stepDuration,
  timeToFrame,
  vuLevel,
} from './timing'
import { playDrum } from './drums'
import { detectOnsets, estimateLatency } from './calibrate'
import workletUrl from './recorder.worklet.ts?worker&url'

interface Rec {
  start: number // instante agendado (relógio do ctx)
  startFrame: number // frame do mic correspondente, já com latência
  data: Float32Array
  filled: number // amostras capturadas a partir de startFrame
  overdub: boolean
}

interface Capture {
  startFrame: number
  data: Float32Array
  filled: number
}
interface Calib {
  cap: Capture
  done: () => void
  abort: () => void
  timers: ReturnType<typeof setTimeout>[]
}

/** Copia o bloco do worklet para a captura; true quando completa. */
function fillCapture(r: Capture, frame: number, data: Float32Array) {
  const len = r.data.length
  const off = frame - r.startFrame
  const from = Math.max(0, -off)
  const to = Math.min(data.length, len - off)
  if (to > from) {
    r.data.set(data.subarray(from, to), off + from)
    r.filled = off + to
  }
  return off + data.length >= len
}

interface Channel {
  input: BiquadFilterNode
  pan: StereoPannerNode
  out: GainNode
  dSend: GainNode
  rSend: GainNode
}
interface Mix {
  ch: Channel[]
  master: GainNode
  delay: DelayNode
}

const LOOKAHEAD = 0.1
const TICK_MS = 25
const STOPPED: Position = { playing: false, phase: 0, beat: 0, step: 0, countIn: false }
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
const BARS = [1, 2, 4] as const
const isBars = (b: unknown): b is 1 | 2 | 4 => BARS.includes(b as 1)

function computePeaks(ch: Float32Array, count: number, total: number) {
  const out = new Float32Array(count)
  const step = total / count
  for (let b = 0; b < count; b++) {
    let max = 0
    const end = Math.min(ch.length, Math.floor((b + 1) * step))
    for (let k = Math.floor(b * step); k < end; k++) {
      const v = Math.abs(ch[k])
      if (v > max) max = v
    }
    out[b] = max
  }
  return out
}

// IR de reverb: ruído estéreo decaindo ~2.5s, uma por sampleRate
const irCache = new Map<number, AudioBuffer>()
function impulse(sampleRate: number) {
  let ir = irCache.get(sampleRate)
  if (ir) return ir
  const length = Math.round(REVERB_SECONDS * sampleRate)
  ir = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let k = 0; k < length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / length, 3)
  }
  irCache.set(sampleRate, ir)
  return ir
}

/** Grafo de mixagem (vivo e offline): canal = filtro → pan → gain → master, envios pós-fader. */
function buildMix(c: BaseAudioContext, count: number): Mix {
  const master = c.createGain()
  const delay = c.createDelay(2)
  const tone = c.createBiquadFilter()
  tone.frequency.value = 3000
  const fb = c.createGain()
  fb.gain.value = DELAY_FEEDBACK
  delay.connect(tone).connect(fb).connect(delay)
  tone.connect(master)
  const verb = c.createConvolver()
  verb.buffer = impulse(c.sampleRate)
  verb.connect(master)
  const ch = Array.from({ length: count }, (): Channel => {
    const input = c.createBiquadFilter() // lowpass por padrão
    const pan = c.createStereoPanner()
    const out = c.createGain()
    const dSend = c.createGain()
    const rSend = c.createGain()
    input.connect(pan).connect(out).connect(master)
    out.connect(dSend).connect(delay)
    out.connect(rSend).connect(verb)
    return { input, pan, out, dSend, rSend }
  })
  return { ch, master, delay }
}

/** t = null: valores imediatos (offline); senão rampa curta a partir de t. */
function applyMix(mix: Mix, s: EngineState, t: number | null) {
  const set = (p: AudioParam, v: number) => {
    if (t === null) p.value = v
    else p.setTargetAtTime(v, t, 0.01)
  }
  const anySolo = s.tracks.some((x) => x.solo)
  s.tracks.forEach((tr, i) => {
    const c = mix.ch[i]
    set(c.input.frequency, filterFreq(tr.filter))
    set(c.pan.pan, tr.pan)
    set(c.out.gain, tr.muted || (anySolo && !tr.solo) ? 0 : tr.volume)
    set(c.dSend.gain, tr.delay)
    set(c.rSend.gain, tr.reverb)
  })
  set(mix.master.gain, s.masterVolume)
  set(mix.delay.delayTime, delayTime(s.bpm))
}

const pickParams = ({ volume, muted, solo, pan, filter, delay, reverb, nudge, overdubbing }: TrackState): TrackParams => ({
  volume, muted, solo, pan, filter, delay, reverb, nudge, overdubbing,
})

function mergeParams(cur: TrackState, p: Partial<TrackParams>): TrackState {
  const mic = cur.kind === 'mic'
  return {
    ...cur,
    volume: clamp(p.volume, 0, 1, cur.volume),
    muted: p.muted === undefined ? cur.muted : !!p.muted,
    solo: p.solo === undefined ? cur.solo : !!p.solo,
    pan: clamp(p.pan, -1, 1, cur.pan),
    filter: clamp(p.filter, 0, 1, cur.filter),
    delay: clamp(p.delay, 0, 1, cur.delay),
    reverb: clamp(p.reverb, 0, 1, cur.reverb),
    nudge: mic ? clamp(p.nudge, -100, 100, cur.nudge) : 0,
    overdubbing: mic && p.overdubbing !== undefined ? !!p.overdubbing : cur.overdubbing,
  }
}

const hasSteps = (p: readonly (readonly boolean[])[]) => p.some((row) => row.some(Boolean))
const emptyPattern = (bars: number) => DRUM_VOICES.map(() => Array<boolean>(bars * STEPS_PER_BAR).fill(false))

export function createEngine(opts: { tracks?: number } = {}): LoopEngine {
  const n = opts.tracks ?? 8 // canais mic
  const N = n + 1 // + bateria
  const D = n // índice do canal drums
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let worklet: AudioWorkletNode | null = null
  let mix: Mix | null = null
  let analysers: AnalyserNode[] = [] // N canais + master
  let outDest: MediaStreamAudioDestinationNode | null = null
  let drumBus: GainNode | null = null // desconectado no stop: corta passos já agendados
  let initPromise: Promise<void> | null = null
  let pendingCleanup: (() => void) | null = null // libera recursos de um init ainda pendente
  let gen = 0 // geração do init: tentativas obsoletas só limpam os próprios recursos
  let inputLatency = 0
  // AudioBuffer não pertence a um contexto: sobrevive a reinit após erro de mic
  const buffers: (AudioBuffer | null)[] = Array(N).fill(null)
  const sources: (AudioBufferSourceNode | null)[] = Array(N).fill(null)
  const retiring = Array.from({ length: N }, () => new Set<AudioBufferSourceNode>()) // trocados, ainda soando
  const recs: (Rec | null)[] = Array(N).fill(null)
  const peaks: ({ count: number; data: Float32Array } | null)[] = Array(N).fill(null)
  const clicks = new Set<OscillatorNode>()
  const levels = new Float32Array(N + 1)
  const scratch = new Float32Array(256)
  let t0 = 0
  let nextBeat = 0
  let nextStep = 0
  let timer: ReturnType<typeof setInterval> | undefined
  // undo de 1 nível: take anterior (null = vazio; undefined = sem undo) e padrão anterior
  const undoTake: (AudioBuffer | null | undefined)[] = Array(N).fill(undefined)
  let undoPattern: boolean[][] | null = null
  let lastToggle = 0
  let calib: Calib | null = null

  const blank = (kind: TrackState['kind']): TrackState => ({
    kind, status: 'empty', volume: 0.8, muted: false, solo: false, pan: 0, filter: 1, delay: 0, reverb: 0, nudge: 0, overdubbing: false, canUndo: false, revision: 0,
  })
  let state: EngineState = {
    status: 'idle',
    error: null,
    bpm: 100,
    bars: 2,
    metronome: true,
    latencyOffset: 0,
    playing: false,
    loopDuration: loopDuration(100, 2),
    masterVolume: 0.9,
    tracks: Array.from({ length: N }, (_, i) => blank(i === D ? 'drums' : 'mic')),
    pattern: emptyPattern(2),
  }
  const listeners = new Set<(s: EngineState) => void>()

  function set(patch: Partial<EngineState>) {
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn(state))
  }
  function patchTrack(i: number, patch: Partial<TrackState>) {
    const tracks = state.tracks.slice()
    tracks[i] = { ...tracks[i], ...patch }
    set({ tracks })
  }
  /** Novo padrão + status do canal drums numa notificação só. */
  function setPatternState(pattern: boolean[][], extra: Partial<EngineState> = {}) {
    const tracks = state.tracks.slice()
    tracks[D] = { ...tracks[D], status: hasSteps(pattern) ? 'recorded' : 'empty', canUndo: undoPattern !== null, revision: tracks[D].revision + 1 }
    set({ ...extra, pattern, tracks })
  }
  /** Guarda o padrão para undo; toggles seguidos (< 1s) ficam num snapshot só. */
  function savePattern(toggle: boolean) {
    const now = performance.now()
    if (!toggle || now - lastToggle > 1000) undoPattern = state.pattern.map((row) => row.slice())
    lastToggle = toggle ? now : 0
  }
  const busy = () => calib !== null
  const ready = () => state.status === 'ready'
  const valid = (i: number) => ready() && Number.isInteger(i) && i >= 0 && i < N
  const locked = () => state.tracks.some((t) => t.kind === 'mic' && t.status !== 'empty')
  const outLatency = () => (ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : 0)
  const rev = (i: number) => state.tracks[i].revision + 1
  const remix = () => ctx && mix && applyMix(mix, state, ctx.currentTime)

  function startSource(i: number, when: number) {
    const old = sources[i]
    when = Math.max(when, t0)
    if (old) {
      // troca sem buraco; fica "em retirada" até parar, para stop/clear alcançá-lo
      retiring[i].add(old)
      old.onended = () => {
        retiring[i].delete(old)
        old.disconnect()
      }
      old.stop(when)
    }
    sources[i] = null
    const buf = buffers[i]
    if (!ctx || !mix || !buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.loopEnd = state.loopDuration // duração exata; o buffer tem ceil() amostras
    src.connect(mix.ch[i].input)
    src.start(when, nudgedOffset(when, t0, state.loopDuration, state.tracks[i].nudge / 1000))
    sources[i] = src
  }
  function stopSource(i: number) {
    const all = sources[i] ? [sources[i]!, ...retiring[i]] : [...retiring[i]]
    all.forEach((s) => {
      s.onended = null
      try {
        s.stop()
      } catch {
        // já parado
      }
      s.disconnect()
    })
    retiring[i].clear()
    sources[i] = null
  }

  function click(t: number, accent: boolean) {
    const c = ctx!
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.frequency.value = accent ? 1500 : 1000
    g.gain.setValueAtTime(accent ? 0.6 : 0.35, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    osc.connect(g).connect(c.destination) // fora do master: não entra no getOutputStream
    osc.onended = () => {
      clicks.delete(osc)
      g.disconnect()
    }
    osc.start(t)
    osc.stop(t + 0.04)
    clicks.add(osc)
  }
  function stopClicks() {
    clicks.forEach((osc) => {
      osc.onended = null
      osc.stop()
      osc.disconnect()
    })
    clicks.clear()
  }
  function resetDrumBus() {
    drumBus?.disconnect()
    drumBus = null
    if (ctx && mix) {
      drumBus = ctx.createGain()
      drumBus.connect(mix.ch[D].input)
    }
  }

  function tick() {
    const c = ctx!
    const now = c.currentTime
    const bd = beatDuration(state.bpm)
    for (; t0 + nextBeat * bd < now + LOOKAHEAD; nextBeat++) {
      const t = t0 + nextBeat * bd
      // contagem (nextBeat < 0) sempre audível; tempos atrasados (aba em 2º plano) são pulados
      if (t >= now && (state.metronome || nextBeat < 0)) click(t, isAccent(nextBeat))
    }
    // bateria a partir de t0 (não toca na contagem)
    const sd = stepDuration(state.bpm)
    const steps = state.bars * STEPS_PER_BAR
    for (; t0 + nextStep * sd < now + LOOKAHEAD; nextStep++) {
      const t = t0 + nextStep * sd
      if (t < now || !drumBus) continue
      const s = nextStep % steps
      state.pattern.forEach((row, v) => {
        if (row[s]) playDrum(c, drumBus!, DRUM_VOICES[v], t)
      })
    }
    recs.forEach((r, i) => {
      if (r && now >= r.start && state.tracks[i].status === 'armed') patchTrack(i, { status: 'recording' })
    })
  }

  /** Reancora a grade em t0 (metrônomo e bateria). */
  function anchor(at: number, countIn: boolean) {
    stopClicks()
    resetDrumBus()
    t0 = at
    nextBeat = countIn ? -BEATS_PER_BAR : 0
    nextStep = 0
  }

  function startTransport(countIn: boolean) {
    const c = ctx!
    const bar = BEATS_PER_BAR * beatDuration(state.bpm)
    anchor(c.currentTime + 0.05 + (countIn ? bar : 0), countIn)
    for (let i = 0; i < n; i++) startSource(i, t0)
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
    tick()
    set({ playing: true })
  }

  const syncWorklet = () => worklet?.port.postMessage(recs.some(Boolean) || calib !== null)

  function endCalib() {
    calib?.timers.forEach(clearTimeout)
    calib = null
    syncWorklet()
  }
  function abortCalib() {
    const c = calib
    if (!c) return
    endCalib()
    c.abort()
  }

  function cancelRec(i: number) {
    const overdub = recs[i]?.overdub
    recs[i] = null
    syncWorklet()
    patchTrack(i, { status: overdub ? 'recorded' : 'empty' })
  }

  function onBlock({ frame, data }: { frame: number; data: Float32Array }) {
    recs.forEach((r, i) => {
      if (r && fillCapture(r, frame, data)) finish(i, r)
    })
    if (calib && fillCapture(calib.cap, frame, data)) calib.done()
  }

  function finish(i: number, r: Rec) {
    const c = ctx!
    const old = buffers[i]
    let buf: AudioBuffer
    if (r.overdub && old) {
      const shift = Math.round((state.tracks[i].nudge / 1000) * old.sampleRate)
      const mixed = overdubMix(old.getChannelData(0), r.data, shift)
      buf = new AudioBuffer({ numberOfChannels: 1, length: mixed.length, sampleRate: old.sampleRate })
      buf.copyToChannel(mixed, 0)
    } else {
      buf = c.createBuffer(1, r.data.length, c.sampleRate)
      buf.copyToChannel(r.data as Float32Array<ArrayBuffer>, 0)
    }
    if (r.overdub) undoTake[i] = old // o substituir já guardou ao armar
    buffers[i] = buf
    peaks[i] = null
    recs[i] = null
    syncWorklet()
    startSource(i, c.currentTime + 0.02)
    patchTrack(i, { status: 'recorded', canUndo: undoTake[i] !== undefined, revision: rev(i) })
  }

  function dropTrack(i: number) {
    stopSource(i)
    buffers[i] = null
    peaks[i] = null
  }

  function stopAll() {
    abortCalib()
    clearInterval(timer)
    timer = undefined
    stopClicks()
    drumBus?.disconnect()
    drumBus = null
    for (let i = 0; i < N; i++) {
      stopSource(i)
      if (recs[i]) cancelRec(i)
    }
    if (state.playing) set({ playing: false })
  }

  // Libera áudio e microfone; mantém buffers gravados. Invalida qualquer init em andamento.
  function teardown() {
    gen++
    pendingCleanup?.()
    pendingCleanup = null
    stopAll()
    releaseStream(stream)
    stream = null
    worklet = null
    mix = null
    analysers = []
    outDest = null
    levels.fill(0)
    if (ctx) {
      ctx.onstatechange = null
      if (ctx.state !== 'closed') void ctx.close()
    }
    ctx = null
  }
  function releaseStream(s: MediaStream | null) {
    s?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
  }

  function fail(e: unknown) {
    if (!ready()) return
    teardown()
    set({ status: 'error', error: errMsg(e) })
  }
  const resume = () => ctx!.resume().catch(fail)

  // Navegador suspendeu o contexto: para o transporte e tenta voltar em até 1s.
  async function onSuspended(ac: AudioContext) {
    stopAll()
    const timeout = new Promise((r) => setTimeout(r, 1000))
    await Promise.race([ac.resume(), timeout]).catch(() => {})
    if (ctx === ac && ac.state !== 'running') fail(new Error('Áudio pausado pelo navegador'))
  }

  async function start() {
    const my = ++gen
    let c: AudioContext | null = null
    let s: MediaStream | null = null
    // idempotente por recurso: chamada de novo após o getUserMedia tardio libera o stream
    const abandon = () => {
      releaseStream(s)
      if (c && c.state !== 'closed') c.close().catch(() => {})
    }
    pendingCleanup = abandon
    const lost = () => {
      if (my !== gen) return
      teardown()
      set({ status: 'error', error: 'Microfone desconectado' })
    }
    set({ status: 'initializing', error: null })
    try {
      c = new AudioContext({ latencyHint: 'interactive' })
      s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      if (my !== gen) return abandon()
      const track = s.getAudioTracks()[0]
      if (track) track.onended = lost
      await c.audioWorklet.addModule(workletUrl)
      if (my !== gen) return abandon()
      const node = new AudioWorkletNode(c, 'recorder', { channelCount: 1, channelCountMode: 'explicit' })
      node.port.onmessage = (e) => onBlock(e.data)
      c.createMediaStreamSource(s).connect(node)
      node.connect(c.destination) // saída silenciosa; só garante que o nó seja processado
      const m = buildMix(c, N)
      const an = [...m.ch.map((ch) => ch.out), m.master].map((src) => {
        const a = c!.createAnalyser()
        a.fftSize = scratch.length
        src.connect(a)
        return a
      })
      const dest = c.createMediaStreamDestination()
      m.master.connect(c.destination)
      m.master.connect(dest)
      await c.resume()
      if (my !== gen) return abandon()
      if (track?.readyState !== 'live') throw new Error('Microfone desconectado')

      // commit: daqui em diante os recursos são do engine
      pendingCleanup = null
      inputLatency = (track.getSettings() as { latency?: number }).latency ?? 0
      const ac = c
      ac.onstatechange = () => {
        const st = ac.state as string
        if (ready() && (st === 'suspended' || st === 'interrupted')) void onSuspended(ac)
      }
      ctx = c
      stream = s
      worklet = node
      mix = m
      analysers = an
      outDest = dest
      applyMix(m, state, null)
      set({ status: 'ready' })
    } catch (e) {
      abandon()
      if (my === gen) {
        pendingCleanup = null
        set({ status: 'error', error: errMsg(e) })
      }
      throw e
    }
  }

  function setTiming(patch: Partial<EngineState>) {
    if (!ready() || locked()) return false
    // take antigo teria outra duração: descarta o undo dos canais mic
    if (undoTake.some((u) => u !== undefined)) {
      undoTake.fill(undefined)
      set({ tracks: state.tracks.map((t) => (t.kind === 'mic' ? { ...t, canUndo: false } : t)) })
    }
    const next = { ...state, ...patch }
    const loop = loopDuration(next.bpm, next.bars)
    if (patch.pattern) setPatternState(patch.pattern as boolean[][], { ...patch, loopDuration: loop })
    else set({ ...patch, loopDuration: loop })
    remix() // tempo do delay
    // sem takes, só metrônomo e bateria dependem de t0: reancora a grade
    if (state.playing && ctx) anchor(ctx.currentTime + 0.05, false)
    return true
  }

  function clear(i: number) {
    if (!valid(i)) return
    if (i === D) {
      if (!hasSteps(state.pattern)) return
      savePattern(false)
      return setPatternState(emptyPattern(state.bars))
    }
    if (recs[i]) {
      recs[i] = null
      syncWorklet()
    }
    if (buffers[i]) undoTake[i] = buffers[i]
    dropTrack(i)
    patchTrack(i, { status: 'empty', canUndo: undoTake[i] !== undefined, revision: rev(i) })
  }

  function undo(i: number) {
    if (!valid(i) || busy()) return
    if (i === D) {
      if (!undoPattern) return
      const p = resizePattern(undoPattern, state.bars * STEPS_PER_BAR)
      undoPattern = null
      lastToggle = 0
      return setPatternState(p)
    }
    const snap = undoTake[i]
    if (recs[i] || snap === undefined) return
    undoTake[i] = undefined
    buffers[i] = snap
    peaks[i] = null
    if (state.playing && ctx) startSource(i, ctx.currentTime + 0.02)
    else stopSource(i)
    patchTrack(i, { status: snap ? 'recorded' : 'empty', canUndo: false, revision: rev(i) })
  }

  async function calibrate(opts: { clicks?: number; onClick?: (i: number) => void } = {}): Promise<CalibrationResult | null> {
    if (!ready()) throw new Error('Engine não está pronto')
    if (busy()) throw new Error('Calibração em andamento')
    stopAll()
    const c = ctx!
    void resume()
    const total = Math.round(clamp(opts.clicks ?? 8, 2, 32, 8))
    const plan = calibrationPlan(c.currentTime, state.bpm, total)
    const sr = c.sampleRate
    // só a compensação automática: o atraso medido é o latencyOffset absoluto
    const latency = captureLatency(outLatency(), inputLatency, 0)
    plan.clickTimes.forEach((t, k) => click(t, k === 0)) // soa mesmo com metrônomo desligado
    return new Promise((resolve, reject) => {
      const heardDelay = (t: number) => Math.max(0, (t + outLatency() - c.currentTime) * 1000)
      const timers = plan.clickTimes.map((t, k) => setTimeout(() => opts.onClick?.(k), heardDelay(t)))
      // segurança: se a captura não completar, analisa o que veio
      timers.push(setTimeout(() => calib?.done(), heardDelay(plan.end) + 2000))
      const cap: Capture = { startFrame: timeToFrame(plan.start, sr, latency), data: new Float32Array(Math.ceil((plan.end - plan.start) * sr)), filled: 0 }
      calib = {
        cap,
        timers,
        abort: () => reject(new Error('Calibração interrompida')),
        done: () => {
          endCalib()
          const est = estimateLatency(
            plan.clickTimes.map((t) => t - plan.start),
            detectOnsets(cap.data.subarray(0, cap.filled), sr),
          )
          if (!est) return resolve(null)
          set({ latencyOffset: clamp(est.offsetMs, -200, 200, state.latencyOffset) })
          resolve({ offsetMs: est.offsetMs, matched: est.matched, total, jitterMs: est.jitterMs })
        },
      }
      syncWorklet()
    })
  }

  return {
    init() {
      if (state.status === 'disposed') return Promise.reject(new Error('Engine descartado'))
      if (!initPromise || state.status === 'error') initPromise = start()
      return initPromise
    },

    dispose() {
      if (state.status === 'disposed') return
      teardown()
      for (let i = 0; i < N; i++) dropTrack(i)
      set({ status: 'disposed', tracks: state.tracks.map((t) => ({ ...t, status: 'empty' as const })) })
      listeners.clear()
    },

    setBpm: (bpm) => setTiming({ bpm: Math.round(clamp(bpm, 60, 180, state.bpm)) }),
    setBars: (bars) =>
      isBars(bars) && setTiming({ bars, pattern: resizePattern(state.pattern, bars * STEPS_PER_BAR) }),
    setMetronome(metronome) {
      if (ready() && metronome !== state.metronome) set({ metronome })
    },
    setLatencyOffset(ms) {
      if (ready()) set({ latencyOffset: clamp(ms, -200, 200, state.latencyOffset) })
    },
    setMasterVolume(volume) {
      if (!ready()) return
      set({ masterVolume: clamp(volume, 0, 1, state.masterVolume) })
      remix()
    },

    calibrateLatency: calibrate,
    undo,

    play() {
      if (!ready() || busy() || state.playing) return
      void resume()
      startTransport(false)
    },
    stop() {
      if (ready() && !busy()) stopAll()
    },

    record(i) {
      if (!valid(i) || i === D || busy()) return
      const c = ctx!
      void resume()
      if (recs[i]) return cancelRec(i)
      const overdub = state.tracks[i].overdubbing && !!buffers[i]
      if (!overdub) {
        undoTake[i] = buffers[i] // substituir descarta o take ao armar (evita vazar no microfone)
        dropTrack(i)
      }
      if (!state.playing) startTransport(true)
      const sr = c.sampleRate
      const latency = captureLatency(outLatency(), inputLatency, state.latencyOffset)
      const start = recordStart(c.currentTime, t0, state.loopDuration, latency)
      recs[i] = {
        start,
        startFrame: timeToFrame(start, sr, latency),
        data: new Float32Array(Math.ceil(state.loopDuration * sr)),
        filled: 0,
        overdub,
      }
      syncWorklet()
      patchTrack(i, { status: 'armed', canUndo: undoTake[i] !== undefined, revision: overdub ? state.tracks[i].revision : rev(i) })
    },

    clear,
    clearAll() {
      if (!ready() || busy()) return
      stopAll()
      if (hasSteps(state.pattern)) savePattern(false)
      for (let i = 0; i < N; i++) {
        if (buffers[i]) undoTake[i] = buffers[i]
        dropTrack(i)
      }
      set({
        tracks: state.tracks.map((t, i) => ({
          ...t,
          status: 'empty' as const,
          revision: t.revision + 1,
          canUndo: i === D ? undoPattern !== null : undoTake[i] !== undefined,
        })),
        pattern: emptyPattern(state.bars),
      })
    },

    setTrack(i, params) {
      if (!valid(i)) return
      const prev = state.tracks[i]
      const next = mergeParams(prev, params)
      patchTrack(i, next)
      remix()
      if (next.nudge !== prev.nudge && state.playing && sources[i] && ctx) startSource(i, ctx.currentTime + 0.02)
    },

    toggleStep(v, s) {
      if (!ready() || !state.pattern[v] || !Number.isInteger(s) || s < 0 || s >= state.pattern[v].length) return
      const pattern = state.pattern.map((row) => row.slice())
      pattern[v][s] = !pattern[v][s]
      savePattern(true)
      setPatternState(pattern)
    },
    setPattern(pattern) {
      if (!ready()) return
      const rows = DRUM_VOICES.map((_, v) => pattern[v] ?? [])
      savePattern(false)
      setPatternState(resizePattern(rows, state.bars * STEPS_PER_BAR))
    },
    triggerDrum(voice: DrumVoice) {
      if (!ready() || !DRUM_VOICES.includes(voice)) return
      void resume()
      playDrum(ctx!, mix!.ch[D].input, voice, ctx!.currentTime)
    },

    getArmedIn(i) {
      const r = i >= 0 && i < N ? recs[i] : null
      if (!r || !ctx || state.tracks[i].status !== 'armed') return null
      return Math.max(0, r.start - heardTime(ctx.currentTime, outLatency()))
    },

    getPosition() {
      if (!ctx || !state.playing) return STOPPED
      return { playing: true, ...positionAt(heardTime(ctx.currentTime, outLatency()), t0, state.bpm, state.bars) }
    },

    getPeaks(i, count) {
      if (!(i >= 0 && i < N) || count <= 0) return null
      const r = recs[i]
      // gravando (substituir): picos parciais sobre a duração total, resto zero; overdub mostra o take
      if (r && !r.overdub) return r.filled > 0 ? computePeaks(r.data.subarray(0, r.filled), count, r.data.length) : null
      const buf = buffers[i]
      if (!buf) return null
      const cached = peaks[i]
      if (cached?.count === count) return cached.data
      const data = computePeaks(buf.getChannelData(0), count, buf.length)
      peaks[i] = { count, data }
      return data
    },

    getLevels() {
      analysers.forEach((a, i) => {
        a.getFloatTimeDomainData(scratch)
        let peak = 0
        for (let k = 0; k < scratch.length; k++) peak = Math.max(peak, Math.abs(scratch[k]))
        levels[i] = Math.max(vuLevel(peak), levels[i] * 0.85) // queda suave
      })
      return levels
    },

    getOutputStream: () => outDest?.stream ?? null,

    async renderMix(loops) {
      if (!ready()) throw new Error('Engine não está pronto')
      const s = state
      const sr = ctx!.sampleRate
      const dur = s.loopDuration
      // pre-roll até as caudas de FX entrarem em regime: o arquivo emenda sem costura
      const win = renderWindow(loops, dur, sr, fxTail(s.bpm))
      const off = new OfflineAudioContext(2, win.total, sr)
      const m = buildMix(off, N)
      applyMix(m, s, null)
      m.master.connect(off.destination)
      for (let i = 0; i < n; i++) {
        const buf = buffers[i]
        if (!buf) continue
        const src = off.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.loopEnd = dur
        src.connect(m.ch[i].input)
        src.start(0, nudgedOffset(0, 0, dur, s.tracks[i].nudge / 1000))
      }
      const sd = stepDuration(s.bpm)
      const steps = s.bars * STEPS_PER_BAR
      for (let k = 0; k < (win.loops + 1) * steps; k++) {
        s.pattern.forEach((row, v) => {
          if (row[k % steps]) playDrum(off, m.ch[D].input, DRUM_VOICES[v], k * sd)
        })
      }
      const full = await off.startRendering()
      const out = new AudioBuffer({ numberOfChannels: 2, length: win.length, sampleRate: sr })
      for (let c = 0; c < 2; c++) out.copyToChannel(full.getChannelData(c).subarray(win.start, win.start + win.length), c)
      return out
    },

    exportProject(): ProjectData {
      const sr = buffers.find(Boolean)?.sampleRate ?? ctx?.sampleRate ?? 48000
      const len = Math.ceil(state.loopDuration * sr)
      return {
        version: 1,
        bpm: state.bpm,
        bars: state.bars,
        masterVolume: state.masterVolume,
        sampleRate: sr,
        tracks: state.tracks.map((t, i) => {
          const b = buffers[i]
          const audio = b ? (b.sampleRate === sr ? b.getChannelData(0).slice() : resample(b.getChannelData(0), len)) : null
          return { ...pickParams(t), audio }
        }),
        pattern: state.pattern.map((row) => row.slice()),
      }
    },

    importProject(data) {
      if (!ready() || busy() || data?.version !== 1) return
      stopAll()
      undoTake.fill(undefined)
      undoPattern = null
      const bars = isBars(data.bars) ? data.bars : state.bars
      const bpm = Math.round(clamp(data.bpm, 60, 180, state.bpm))
      const sr = clamp(data.sampleRate, 3000, 768000, ctx!.sampleRate)
      const tracks = state.tracks.map((cur, i) => {
        const t = data.tracks?.[i]
        const audio = i < n ? t?.audio : null
        dropTrack(i)
        if (audio?.length) {
          buffers[i] = new AudioBuffer({ numberOfChannels: 1, length: audio.length, sampleRate: sr })
          buffers[i]!.copyToChannel(Float32Array.from(audio), 0)
        }
        return { ...mergeParams(cur, t ?? {}), status: buffers[i] ? ('recorded' as const) : ('empty' as const), canUndo: false, revision: cur.revision + 1 }
      })
      const pattern = resizePattern(
        DRUM_VOICES.map((_, v) => data.pattern?.[v] ?? []),
        bars * STEPS_PER_BAR,
      )
      tracks[D] = { ...tracks[D], status: hasSteps(pattern) ? 'recorded' : 'empty' }
      set({
        bpm,
        bars,
        loopDuration: loopDuration(bpm, bars),
        masterVolume: clamp(data.masterVolume, 0, 1, state.masterVolume),
        tracks,
        pattern,
      })
      remix()
    },

    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
