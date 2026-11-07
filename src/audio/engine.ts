import type { CalibrationResult, DrumVoice, EngineState, Instrument, LoopEngine, Position, ProjectData, TrackParams, TrackSource, TrackState } from './types'
import { DRUM_VOICES, INSTRUMENTS, INSTRUMENT_OCTAVE, isInstrument, KEYS, PAD_COUNT, PAD_SCALES, STEPS_PER_BAR } from './types'
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
  liveStepToSkip,
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
import { isSilent } from './silence'
import { padNotes } from './scale'
import { renderNotes, startVoice, type Note, type Voice } from './synth'
import { detectOnsets, estimateLatency } from './calibrate'
import workletUrl from './recorder.worklet.ts?worker&url'

interface TakeSnapshot {
  buffer: AudioBuffer | null
  source: TrackSource
}

interface LiveVoice {
  voice: Voice
  degree: number
  midi: number
  forced: boolean
}

interface Rec {
  start: number // instante agendado (relógio do ctx)
  startFrame: number // frame do mic correspondente, já com latência
  data: Float32Array
  filled: number // amostras capturadas a partir de startFrame
  overdub: boolean
  previousUndo: TakeSnapshot | undefined
  source: TrackSource
  notes: Note[]
  held: Map<number, Note>
  rendering: boolean
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
function applyMix(mix: Mix, s: EngineState, t: number | null, master = true, monitor = false) {
  const set = (p: AudioParam, v: number) => {
    if (t === null) p.value = v
    else p.setTargetAtTime(v, t, 0.01)
  }
  const anySolo = s.tracks.some((x) => x.solo)
  const isolating = monitor && s.isolateRecording && s.tracks.some((tr) => tr.kind === 'mic' && (tr.status === 'armed' || tr.status === 'recording'))
  s.tracks.forEach((tr, i) => {
    const c = mix.ch[i]
    set(c.input.frequency, filterFreq(tr.filter))
    set(c.pan.pan, tr.pan)
    const active = tr.kind === 'mic' && (tr.status === 'armed' || tr.status === 'recording')
    set(c.out.gain, tr.muted || (anySolo && !tr.solo) || (isolating && !active) ? 0 : tr.volume)
    set(c.dSend.gain, tr.delay)
    set(c.rSend.gain, tr.reverb)
  })
  if (master) set(mix.master.gain, s.masterVolume)
  set(mix.delay.delayTime, delayTime(s.bpm))
}

const pickParams = ({ name, volume, muted, solo, pan, filter, delay, reverb, nudge, overdubbing, source }: TrackState): TrackParams => ({
  name, volume, muted, solo, pan, filter, delay, reverb, nudge, overdubbing, source,
})

const validSource = (source: unknown): source is TrackSource =>
  source === 'mic' || INSTRUMENTS.includes(source as Instrument)
const REVERB_DEFAULT: Record<Instrument, number> = { ocarina: 0.2, flute: 0.2, kalimba: 0.15, bass: 0 }
const sourceReverb = (source: TrackSource, reverb: number) =>
  isInstrument(source) && reverb === 0 ? REVERB_DEFAULT[source] : reverb

function mergeParams(cur: TrackState, p: Partial<TrackParams>, defaultName: string): TrackState {
  const mic = cur.kind === 'mic'
  const source = mic && validSource(p.source) ? p.source : cur.source
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) || defaultName : cur.name
  return {
    ...cur,
    name,
    volume: clamp(p.volume, 0, 1, cur.volume),
    muted: p.muted === undefined ? cur.muted : !!p.muted,
    solo: p.solo === undefined ? cur.solo : !!p.solo,
    pan: clamp(p.pan, -1, 1, cur.pan),
    filter: clamp(p.filter, 0, 1, cur.filter),
    delay: clamp(p.delay, 0, 1, cur.delay),
    reverb: clamp(p.reverb, 0, 1, cur.reverb),
    nudge: mic ? clamp(p.nudge, -100, 100, cur.nudge) : 0,
    overdubbing: mic && p.overdubbing !== undefined ? !!p.overdubbing : cur.overdubbing,
    source,
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
  let inputSource: MediaStreamAudioSourceNode | null = null
  let inputAnalyser: AnalyserNode | null = null
  let micPromise: Promise<boolean> | null = null
  let pendingMicCleanup: (() => void) | null = null
  let micGen = 0
  let hasPlayed = false
  let fadeStart = 0
  let fadeEnd = 0
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
  const heldVoices = Array.from({ length: N }, () => new Map<number, LiveVoice>())
  const sounding = Array.from({ length: N }, () => new Set<LiveVoice>())
  const peaks: ({ count: number; data: Float32Array } | null)[] = Array(N).fill(null)
  const clicks = new Set<OscillatorNode>()
  const levels = new Float32Array(N + 1)
  const scratch = new Float32Array(256)
  let t0 = 0
  let nextBeat = 0
  let nextStep = 0
  const skippedSteps = new Map<string, number>()
  let timer: ReturnType<typeof setInterval> | undefined
  // undo de 1 nível: take/source anteriores (buffer null = vazio; undefined = sem undo) e padrão anterior
  const undoTake: (TakeSnapshot | undefined)[] = Array(N).fill(undefined)
  const takeSnapshot = (i: number): TakeSnapshot => ({ buffer: buffers[i], source: state.tracks[i].source })
  let removedTrack: {
    index: number
    track: TrackState
    buffer: AudioBuffer | null
    undo: TakeSnapshot | undefined
    peaks: (typeof peaks)[number]
  } | null = null
  let undoPattern: boolean[][] | null = null
  let lastToggle = 0
  let calib: Calib | null = null

  const defaultName = (i: number) => (i === D ? 'Bateria' : `Faixa ${i + 1}`)
  const blank = (kind: TrackState['kind'], name: string): TrackState => ({
    kind, name, status: 'empty', volume: 0.8, muted: false, solo: false, pan: 0, filter: 1, delay: 0, reverb: 0, nudge: 0, overdubbing: false, source: 'mic', canUndo: false, silentTake: false, revision: 0,
  })
  let state: EngineState = {
    status: 'idle',
    error: null,
    mic: 'off',
    micError: null,
    micTrack: null,
    bpm: 100,
    bars: 2,
    metronome: true,
    latencyOffset: 0,
    playing: false,
    loopDuration: loopDuration(100, 2),
    masterVolume: 0.9,
    key: 'C',
    scale: 'pentatonic',
    isolateRecording: false,
    canRestoreTrack: false,
    tracks: Array.from({ length: N }, (_, i) => blank(i === D ? 'drums' : 'mic', defaultName(i))),
    pattern: emptyPattern(2),
  }
  const listeners = new Set<(s: EngineState) => void>()

  function set(patch: Partial<EngineState>) {
    state = { ...state, ...patch }
    if (patch.tracks || patch.isolateRecording !== undefined) remix()
    listeners.forEach((fn) => fn(state))
  }
  function patchTrack(i: number, patch: Partial<TrackState>) {
    const tracks = state.tracks.slice()
    tracks[i] = { ...tracks[i], ...patch }
    set({ tracks })
  }
  /** Novo padrão + status do canal drums numa notificação só. */
  function setPatternState(pattern: boolean[][], extra: Partial<EngineState> = {}, keepSkips = false) {
    if (!keepSkips) skippedSteps.clear()
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
  function remix() {
    if (!ctx || !mix) return
    const now = ctx.currentTime
    applyMix(mix, state, now, false, true)
    if (now < fadeEnd) {
      const gain = mix.master.gain
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(state.masterVolume * Math.max(0, (now - fadeStart) / (fadeEnd - fadeStart)), now)
      gain.linearRampToValueAtTime(state.masterVolume, fadeEnd)
    } else mix.master.gain.setTargetAtTime(state.masterVolume, now, 0.01)
  }

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
      const s = nextStep % steps
      state.pattern.forEach((row, v) => {
        const key = `${v}:${s}`
        const skipped = skippedSteps.get(key)
        if (skipped !== undefined && skipped <= nextStep) skippedSteps.delete(key)
        if (skipped === nextStep || t < now || !drumBus) return
        if (row[s]) playDrum(c, drumBus, DRUM_VOICES[v], t)
      })
    }
    recs.forEach((r, i) => {
      if (r && isInstrument(r.source)) updateInstrument(i)
      else if (r && now >= r.start && state.tracks[i].status === 'armed') patchTrack(i, { status: 'recording' })
    })
  }

  /** Reancora a grade em t0 (metrônomo e bateria). */
  function anchor(at: number, countIn: boolean) {
    skippedSteps.clear()
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

  const syncWorklet = () => worklet?.port.postMessage(recs.some((r) => r?.source === 'mic') || calib !== null)

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
      if (r?.source === 'mic' && fillCapture(r, frame, data)) finish(i, r)
    })
    if (calib && fillCapture(calib.cap, frame, data)) calib.done()
  }

  function closeNote(i: number, degree: number, end?: number) {
    const r = recs[i]
    const note = r?.held.get(degree)
    if (!r || !note) return
    const time = end ?? Math.min(state.loopDuration, Math.max(0, heardTime(ctx!.currentTime, outLatency()) - r.start))
    note.duration = Math.max(0, time - note.time)
    r.held.delete(degree)
  }

  function releaseHeld(i: number, entry: LiveVoice) {
    if (heldVoices[i].get(entry.degree) !== entry) return
    heldVoices[i].delete(entry.degree)
    closeNote(i, entry.degree)
  }

  function cutVoice(i: number, entry: LiveVoice) {
    if (!entry.forced) {
      entry.forced = true
      entry.voice.stop(ctx!.currentTime, 0.06)
    }
    releaseHeld(i, entry)
  }

  function stopNote(i: number, degree: number) {
    const entry = heldVoices[i].get(degree)
    if (!entry) return
    entry.voice.stop(ctx!.currentTime)
    releaseHeld(i, entry)
  }

  function stopLive(i: number) {
    for (const entry of sounding[i]) cutVoice(i, entry)
  }

  function updateInstrument(i: number) {
    const r = recs[i]
    if (!r || !isInstrument(r.source) || r.rendering || !ctx) return
    const now = heardTime(ctx.currentTime, outLatency())
    if (now < r.start) return
    if (state.tracks[i].status === 'armed') {
      for (const [degree, voice] of heldVoices[i]) {
        if (!sounding[i].has(voice) || voice.forced) continue
        const note: Note = { time: 0, duration: 0, midi: voice.midi }
        r.notes.push(note)
        r.held.set(degree, note)
      }
      patchTrack(i, { status: 'recording' })
    }
    if (now < r.start + state.loopDuration) return
    for (const degree of r.held.keys()) closeNote(i, degree, state.loopDuration)
    r.rendering = true
    stopLive(i)
    if (!r.notes.length) return finish(i, r)
    void renderNotes(r.notes, state.loopDuration, ctx.sampleRate, r.source).then((buffer) => {
      if (recs[i] !== r || !ready()) return
      r.data = buffer.getChannelData(0).slice()
      finish(i, r)
    }).catch((e: unknown) => {
      if (recs[i] !== r || !ready()) return
      set({ error: errMsg(e) })
      finish(i, r)
    })
  }

  function noteOn(i: number, degree: number) {
    if (!valid(i) || i === D || busy() ||
      !Number.isInteger(degree) || degree < 0 || degree >= PAD_COUNT[state.scale]) return
    const source = state.tracks[i].source
    if (!isInstrument(source)) return
    void resume()
    updateInstrument(i)
    const previous = heldVoices[i].get(degree)
    if (previous) cutVoice(i, previous)
    const active = [...sounding[i]].filter(voice => !voice.forced)
    if (active.length >= 4) cutVoice(i, active[0])
    const midi = padNotes(state.key, state.scale, INSTRUMENT_OCTAVE[source])[degree]
    const entry: LiveVoice = {
      voice: startVoice(ctx!, mix!.ch[i].input, midi, ctx!.currentTime, source), degree, midi, forced: false,
    }
    heldVoices[i].set(degree, entry)
    sounding[i].add(entry)
    entry.voice.onEnded(() => {
      sounding[i].delete(entry)
      releaseHeld(i, entry)
    })
    const r = recs[i]
    const heard = heardTime(ctx!.currentTime, outLatency())
    if (r && isInstrument(r.source) && !r.rendering && heard >= r.start && heard < r.start + state.loopDuration) {
      const note: Note = { time: (heard - r.start) % state.loopDuration, duration: 0, midi }
      r.notes.push(note)
      r.held.set(degree, note)
    }
  }

  function noteOff(i: number, degree: number) {
    if (!valid(i) || i === D) return
    updateInstrument(i)
    stopNote(i, degree)
  }

  function finish(i: number, r: Rec) {
    const c = ctx!
    const old = buffers[i]
    if (isSilent(r.data)) {
      if (!r.overdub) {
        buffers[i] = undoTake[i]?.buffer ?? null
        undoTake[i] = r.previousUndo
        peaks[i] = null
        startSource(i, c.currentTime + 0.02)
      }
      recs[i] = null
      syncWorklet()
      patchTrack(i, {
        status: buffers[i] ? 'recorded' : 'empty',
        canUndo: undoTake[i] !== undefined,
        silentTake: true,
        revision: rev(i),
      })
      return
    }
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
    if (r.overdub) undoTake[i] = takeSnapshot(i) // o substituir já guardou ao armar
    buffers[i] = buf
    peaks[i] = null
    recs[i] = null
    syncWorklet()
    startSource(i, c.currentTime + 0.02)
    patchTrack(i, { status: 'recorded', canUndo: undoTake[i] !== undefined, silentTake: false, revision: rev(i) })
  }

  function dropTrack(i: number) {
    stopSource(i)
    buffers[i] = null
    peaks[i] = null
  }

  function stopAll() {
    skippedSteps.clear()
    if (state.micTrack !== null) set({ micTrack: null })
    abortCalib()
    clearInterval(timer)
    timer = undefined
    stopClicks()
    drumBus?.disconnect()
    drumBus = null
    for (let i = 0; i < N; i++) {
      stopLive(i)
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
    releaseMic()
    set({ mic: 'off', micError: null, micTrack: null })
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

  function releaseMic() {
    micGen++
    pendingMicCleanup?.()
    pendingMicCleanup = null
    micPromise = null
    inputSource?.disconnect()
    inputAnalyser?.disconnect()
    if (worklet) {
      worklet.port.onmessage = null
      worklet.port.close()
      worklet.disconnect()
    }
    releaseStream(stream)
    stream = null
    worklet = null
    inputSource = null
    inputAnalyser = null
    inputLatency = 0
  }

  async function requestMic(): Promise<boolean> {
    const my = ++micGen
    const c = ctx!
    let s: MediaStream | null = null
    let node: AudioWorkletNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    const abandon = () => {
      releaseStream(s)
      source?.disconnect()
      analyser?.disconnect()
      if (node) {
        node.port.onmessage = null
        node.port.close()
        node.disconnect()
      }
    }
    pendingMicCleanup = abandon
    set({ mic: 'requesting', micError: null })
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      if (my !== micGen || !ready()) { abandon(); return false }
      const track = s.getAudioTracks()[0]
      const lost = () => {
        if (my !== micGen) return
        for (let i = 0; i < n; i++) if (recs[i]?.source === 'mic') cancelRec(i)
        abortCalib()
        releaseMic()
        set({ mic: 'missing', micError: 'Microfone desconectado' })
      }
      if (track) track.onended = lost
      await c.audioWorklet.addModule(workletUrl)
      if (my !== micGen || !ready()) { abandon(); return false }
      if (track?.readyState !== 'live') throw new Error('Microfone desconectado')
      node = new AudioWorkletNode(c, 'recorder', { channelCount: 1, channelCountMode: 'explicit' })
      node.port.onmessage = (e) => onBlock(e.data)
      source = c.createMediaStreamSource(s)
      analyser = c.createAnalyser()
      analyser.fftSize = scratch.length
      source.connect(analyser)
      source.connect(node)
      node.connect(c.destination)
      inputLatency = (track.getSettings() as { latency?: number }).latency ?? 0
      pendingMicCleanup = null
      stream = s
      worklet = node
      inputSource = source
      inputAnalyser = analyser
      set({ mic: 'ready', micError: null })
      const pending = state.micTrack
      if (pending !== null && ready() && state.mic === 'ready') {
        set({ micTrack: null })
        record(pending)
      }
      return ready() && state.mic === 'ready'
    } catch (e) {
      abandon()
      if (my === micGen && ready()) {
        pendingMicCleanup = null
        const denied = e instanceof Error && e.name === 'NotAllowedError'
        set({ mic: denied ? 'denied' : 'missing', micError: errMsg(e) })
      }
      return false
    }
  }

  function ensureMic(): Promise<boolean> {
    if (!ready()) return Promise.resolve(false)
    if (micPromise) return micPromise
    if (state.mic === 'ready') return Promise.resolve(true)
    let settle!: (value: boolean) => void
    const promise = new Promise<boolean>((resolve) => { settle = resolve })
    micPromise = promise
    void requestMic().then((ok) => {
      if (micPromise === promise) micPromise = null
      settle(ok)
    })
    return promise
  }

  async function start() {
    const my = ++gen
    let c: AudioContext | null = null
    const abandon = () => {
      if (c && c.state !== 'closed') void c.close().catch(() => {})
    }
    pendingCleanup = abandon
    set({ status: 'initializing', error: null })
    try {
      c = new AudioContext({ latencyHint: 'interactive' })
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
      pendingCleanup = null
      const ac = c
      ac.onstatechange = () => {
        const st = ac.state as string
        if (ready() && (st === 'suspended' || st === 'interrupted')) void onSuspended(ac)
      }
      ctx = c
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
    // a faixa removida também tem a duração antiga
    if (removedTrack) {
      removedTrack = null
      set({ canRestoreTrack: false })
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
    stopLive(i)
    if (state.micTrack === i) set({ micTrack: null })
    if (recs[i]) {
      recs[i] = null
      syncWorklet()
    }
    if (buffers[i]) undoTake[i] = takeSnapshot(i)
    dropTrack(i)
    patchTrack(i, { status: 'empty', canUndo: undoTake[i] !== undefined, silentTake: false, revision: rev(i) })
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
    if (recs[i]) return
    if (snap === undefined) {
      if (state.tracks[i].silentTake) patchTrack(i, { silentTake: false })
      return
    }
    undoTake[i] = undefined
    if (snap.source !== state.tracks[i].source) stopLive(i)
    buffers[i] = snap.buffer
    peaks[i] = null
    if (state.playing && ctx) startSource(i, ctx.currentTime + 0.02)
    else stopSource(i)
    patchTrack(i, { status: snap.buffer ? 'recorded' : 'empty', source: snap.source, canUndo: false, silentTake: false, revision: rev(i) })
  }

  async function calibrate(opts: { clicks?: number; onClick?: (i: number) => void } = {}): Promise<CalibrationResult | null> {
    if (!ready()) throw new Error('Engine não está pronto')
    if (busy()) throw new Error('Calibração em andamento')
    set({ micTrack: null })
    if (!(await ensureMic()) || !ready()) return null
    if (state.tracks.some((track) => track.status === 'armed' || track.status === 'recording')) return null
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

  const recording = () => state.tracks.some((tr) => tr.status === 'armed' || tr.status === 'recording')
  function shiftedTrack(track: TrackState, from: number, to: number): TrackState {
    return {
      ...track,
      name: track.name === defaultName(from) ? defaultName(to) : track.name,
      revision: Math.max(track.revision, state.tracks[to].revision) + 1,
    }
  }
  function stopShifted(from: number) {
    for (let j = from; j < n; j++) { stopLive(j); stopSource(j) }
  }
  function restartShifted(from: number) {
    if (state.playing && ctx) for (let j = from; j < n; j++) startSource(j, ctx.currentTime + 0.02)
  }
  function removeTrack(i: number) {
    if (!valid(i) || i === D || busy() || recording()) return
    removedTrack = { index: i, track: state.tracks[i], buffer: buffers[i], undo: undoTake[i], peaks: peaks[i] }
    stopShifted(i)
    const tracks = state.tracks.slice()
    for (let j = i; j < n - 1; j++) {
      tracks[j] = shiftedTrack(state.tracks[j + 1], j + 1, j)
      buffers[j] = buffers[j + 1]
      undoTake[j] = undoTake[j + 1]
      peaks[j] = peaks[j + 1]
    }
    tracks[n - 1] = { ...blank('mic', defaultName(n - 1)), revision: state.tracks[n - 1].revision + 1 }
    buffers[n - 1] = null
    undoTake[n - 1] = undefined
    peaks[n - 1] = null
    set({ tracks, micTrack: null, canRestoreTrack: true })
    restartShifted(i)
  }
  function restoreTrack() {
    if (!ready() || busy() || recording() || !removedTrack || buffers[n - 1] || state.tracks[n - 1].status !== 'empty') return
    const saved = removedTrack
    stopShifted(saved.index)
    const tracks = state.tracks.slice()
    for (let j = n - 1; j > saved.index; j--) {
      tracks[j] = shiftedTrack(state.tracks[j - 1], j - 1, j)
      buffers[j] = buffers[j - 1]
      undoTake[j] = undoTake[j - 1]
      peaks[j] = peaks[j - 1]
    }
    const i = saved.index
    tracks[i] = shiftedTrack(saved.track, i, i)
    buffers[i] = saved.buffer
    undoTake[i] = saved.undo
    peaks[i] = saved.peaks
    removedTrack = null
    set({ tracks, micTrack: null, canRestoreTrack: false })
    restartShifted(i)
  }

  function record(i: number) {
    if (!valid(i) || i === D || busy()) return
    if (state.tracks[i].source === 'mic' && state.mic !== 'ready') {
      if (state.mic === 'requesting' && state.micTrack === i) {
        set({ micTrack: null })
        return
      }
      set({ micTrack: i })
      void ensureMic()
      return
    }
    const c = ctx!
    void resume()
    if (recs[i]) return cancelRec(i)
    const previousUndo = undoTake[i]
    const overdub = state.tracks[i].overdubbing && !!buffers[i]
    if (!overdub) {
      undoTake[i] = takeSnapshot(i) // substituir descarta o take ao armar (evita vazar no microfone)
      dropTrack(i)
    }
    if (!state.playing) startTransport(true)
    const sr = c.sampleRate
    const source = state.tracks[i].source
    const latency = source === 'mic' ? captureLatency(outLatency(), inputLatency, state.latencyOffset) : 0
    const start = recordStart(c.currentTime, t0, state.loopDuration, latency)
    recs[i] = {
      start,
      startFrame: timeToFrame(start, sr, latency),
      data: new Float32Array(Math.ceil(state.loopDuration * sr)),
      filled: 0,
      overdub,
      previousUndo,
      source,
      notes: [],
      held: new Map(),
      rendering: false,
    }
    syncWorklet()
    patchTrack(i, { status: 'armed', silentTake: false, canUndo: undoTake[i] !== undefined, revision: overdub ? state.tracks[i].revision : rev(i) })
  }

  return {
    init() {
      if (state.status === 'disposed') return Promise.reject(new Error('Engine descartado'))
      if (!initPromise || state.status === 'error') initPromise = start()
      return initPromise
    },

    ensureMic,

    dispose() {
      if (state.status === 'disposed') return
      teardown()
      removedTrack = null
      for (let i = 0; i < N; i++) {
        heldVoices[i].clear()
        sounding[i].clear()
        dropTrack(i)
      }
      set({ status: 'disposed', canRestoreTrack: false, tracks: state.tracks.map((t) => ({ ...t, status: 'empty' as const })) })
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
    setKey(key) {
      if (ready() && KEYS.includes(key) && key !== state.key) set({ key })
    },
    setScale(scale) {
      if (!ready() || !PAD_SCALES.includes(scale) || scale === state.scale) return
      for (let i = 0; i < n; i++) stopLive(i)
      set({ scale })
    },
    noteOn,
    noteOff,

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
      if (!hasPlayed) {
        hasPlayed = true
        fadeStart = ctx!.currentTime
        fadeEnd = fadeStart + 0.8
        remix()
      }
      startTransport(false)
    },
    stop() {
      if (ready() && !busy()) stopAll()
    },

    record,

    clear,
    removeTrack,
    restoreTrack,
    setIsolateRecording(on) {
      if (ready() && on !== state.isolateRecording) set({ isolateRecording: on })
    },
    clearAll() {
      if (!ready() || busy()) return
      stopAll()
      removedTrack = null
      if (hasSteps(state.pattern)) savePattern(false)
      for (let i = 0; i < N; i++) {
        if (buffers[i]) undoTake[i] = takeSnapshot(i)
        dropTrack(i)
      }
      set({
        tracks: state.tracks.map((t, i) => ({
          ...t,
          status: 'empty' as const,
          silentTake: false,
          revision: t.revision + 1,
          canUndo: i === D ? undoPattern !== null : undoTake[i] !== undefined,
        })),
        pattern: emptyPattern(state.bars),
        canRestoreTrack: false,
      })
    },

    setTrack(i, params) {
      if (!valid(i)) return
      const prev = state.tracks[i]
      const merged = mergeParams(prev, params, defaultName(i))
      const next = { ...merged, reverb: merged.source !== prev.source ? sourceReverb(merged.source, merged.reverb) : merged.reverb }
      if (next.source !== prev.source) {
        stopLive(i)
        if (recs[i]) cancelRec(i)
        if (state.micTrack === i) set({ micTrack: null })
      }
      patchTrack(i, { ...next, status: state.tracks[i].status })
      remix()
      if (next.nudge !== prev.nudge && state.playing && sources[i] && ctx) startSource(i, ctx.currentTime + 0.02)
    },

    toggleStep(v, s, opts) {
      if (!ready() || !state.pattern[v] || !Number.isInteger(s) || s < 0 || s >= state.pattern[v].length) return
      const pattern = state.pattern.map((row) => row.slice())
      pattern[v][s] = !pattern[v][s]
      const key = `${v}:${s}`
      skippedSteps.delete(key)
      if (pattern[v][s] && opts?.skipNext && state.playing && ctx) {
        const occurrence = liveStepToSkip(
          s,
          state.bars * STEPS_PER_BAR,
          (heardTime(ctx.currentTime, outLatency()) - t0) / stepDuration(state.bpm),
          nextStep,
        )
        if (occurrence !== null) skippedSteps.set(key, occurrence)
      }
      savePattern(true)
      setPatternState(pattern, {}, true)
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

    getTakeAudio(i) {
      if (!Number.isInteger(i) || i < 0 || i >= n || state.tracks[i].status !== 'recorded') return null
      const buffer = buffers[i]
      return buffer ? { samples: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate } : null
    },

    applyTake(i, samples, opts = {}) {
      if (!valid(i) || i === D || busy() || recs[i] ||
        state.tracks[i].status === 'armed' || state.tracks[i].status === 'recording') return
      const c = ctx!
      const sampleRate = opts.sampleRate ?? c.sampleRate
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return
      const buffer = c.createBuffer(1, Math.ceil(state.loopDuration * c.sampleRate), c.sampleRate)
      const data = buffer.getChannelData(0)
      if (sampleRate === c.sampleRate) data.set(samples.subarray(0, data.length))
      else {
        const ratio = sampleRate / c.sampleRate
        for (let j = 0; j < data.length; j++) {
          const x = j * ratio
          const k = Math.floor(x)
          if (k >= samples.length) break
          const a = samples[k]
          data[j] = a + ((samples[k + 1] ?? a) - a) * (x - k)
        }
      }
      const source = validSource(opts.source) ? opts.source : state.tracks[i].source
      undoTake[i] = takeSnapshot(i)
      if (source !== state.tracks[i].source) stopLive(i)
      if (state.micTrack === i) set({ micTrack: null })
      buffers[i] = buffer
      peaks[i] = null
      if (state.playing) startSource(i, c.currentTime + 0.02)
      patchTrack(i, { source, reverb: sourceReverb(source, state.tracks[i].reverb), status: 'recorded', canUndo: true, silentTake: false, revision: rev(i) })
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

    getInputLevel() {
      if (state.mic !== 'ready' || !inputAnalyser) return 0
      inputAnalyser.getFloatTimeDomainData(scratch)
      let peak = 0
      for (const sample of scratch) peak = Math.max(peak, Math.abs(sample))
      return vuLevel(peak)
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
        key: state.key,
        scale: state.scale,
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
      removedTrack = null
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
        return { ...mergeParams({ ...cur, name: defaultName(i), source: 'mic' }, t ?? {}, defaultName(i)), status: buffers[i] ? ('recorded' as const) : ('empty' as const), canUndo: false, silentTake: false, revision: cur.revision + 1 }
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
        key: data.key && KEYS.includes(data.key) ? data.key : 'C',
        scale: data.scale && PAD_SCALES.includes(data.scale) ? data.scale : 'pentatonic',
        canRestoreTrack: false,
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
