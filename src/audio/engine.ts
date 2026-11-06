import type { EngineState, LoopEngine, Position, TrackState } from './types'
import {
  beatDuration,
  BEATS_PER_BAR,
  captureLatency,
  heardTime,
  isAccent,
  loopDuration,
  loopOffset,
  positionAt,
  recordStart,
  timeToFrame,
} from './timing'
import workletUrl from './recorder.worklet.ts?worker&url'

interface Rec {
  start: number // instante agendado (relógio do ctx)
  startFrame: number // frame do mic correspondente, já com latência
  data: Float32Array
  filled: number // amostras capturadas a partir de startFrame
}

const LOOKAHEAD = 0.1
const TICK_MS = 25
const STOPPED: Position = { playing: false, phase: 0, beat: 0, countIn: false }
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

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

export function createEngine(opts: { tracks?: number } = {}): LoopEngine {
  const n = opts.tracks ?? 4
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let worklet: AudioWorkletNode | null = null
  let initPromise: Promise<void> | null = null
  let pendingCleanup: (() => void) | null = null // libera recursos de um init ainda pendente
  let gen = 0 // geração do init: tentativas obsoletas só limpam os próprios recursos
  let inputLatency = 0
  let gains: GainNode[] = []
  // AudioBuffer não pertence a um contexto: sobrevive a reinit após erro de mic
  const buffers: (AudioBuffer | null)[] = Array(n).fill(null)
  const sources: (AudioBufferSourceNode | null)[] = Array(n).fill(null)
  const recs: (Rec | null)[] = Array(n).fill(null)
  const peaks: ({ count: number; data: Float32Array } | null)[] = Array(n).fill(null)
  const clicks = new Set<OscillatorNode>()
  let t0 = 0
  let nextBeat = 0
  let timer: ReturnType<typeof setInterval> | undefined

  let state: EngineState = {
    status: 'idle',
    error: null,
    bpm: 100,
    bars: 2,
    metronome: true,
    latencyOffset: 0,
    playing: false,
    loopDuration: loopDuration(100, 2),
    tracks: Array.from({ length: n }, (): TrackState => ({ status: 'empty', volume: 0.8, muted: false })),
  }
  const listeners = new Set<(s: EngineState) => void>()

  function set(patch: Partial<EngineState>) {
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn(state))
  }
  function setTrack(i: number, patch: Partial<TrackState>) {
    const tracks = state.tracks.slice()
    tracks[i] = { ...tracks[i], ...patch }
    set({ tracks })
  }
  const ready = () => state.status === 'ready'
  const valid = (i: number) => ready() && Number.isInteger(i) && i >= 0 && i < n
  const locked = () => state.tracks.some((t) => t.status !== 'empty')
  const outLatency = () => (ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : 0)

  function applyGain(i: number) {
    if (!ctx) return
    const t = state.tracks[i]
    gains[i].gain.setTargetAtTime(t.muted ? 0 : t.volume, ctx.currentTime, 0.01)
  }

  function startSource(i: number, when: number) {
    stopSource(i)
    const buf = buffers[i]
    if (!ctx || !buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.loopEnd = state.loopDuration // duração exata; o buffer tem ceil() amostras
    src.connect(gains[i])
    when = Math.max(when, t0)
    src.start(when, loopOffset(when, t0, state.loopDuration))
    sources[i] = src
  }
  function stopSource(i: number) {
    sources[i]?.stop()
    sources[i]?.disconnect()
    sources[i] = null
  }

  function click(t: number, accent: boolean) {
    const c = ctx!
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.frequency.value = accent ? 1500 : 1000
    g.gain.setValueAtTime(accent ? 0.6 : 0.35, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    osc.connect(g).connect(c.destination)
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

  function tick() {
    const now = ctx!.currentTime
    const bd = beatDuration(state.bpm)
    for (; t0 + nextBeat * bd < now + LOOKAHEAD; nextBeat++) {
      const t = t0 + nextBeat * bd
      // contagem (nextBeat < 0) sempre audível; tempos atrasados (aba em 2º plano) são pulados
      if (t >= now && (state.metronome || nextBeat < 0)) click(t, isAccent(nextBeat))
    }
    recs.forEach((r, i) => {
      if (r && now >= r.start && state.tracks[i].status === 'armed') setTrack(i, { status: 'recording' })
    })
  }

  function startTransport(countIn: boolean) {
    const c = ctx!
    const bar = BEATS_PER_BAR * beatDuration(state.bpm)
    t0 = c.currentTime + 0.05 + (countIn ? bar : 0)
    nextBeat = countIn ? -BEATS_PER_BAR : 0
    for (let i = 0; i < n; i++) startSource(i, t0)
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
    tick()
    set({ playing: true })
  }

  const syncWorklet = () => worklet?.port.postMessage(recs.some(Boolean))

  function cancelRec(i: number) {
    recs[i] = null
    syncWorklet()
    setTrack(i, { status: 'empty' })
  }

  function onBlock({ frame, data }: { frame: number; data: Float32Array }) {
    recs.forEach((r, i) => {
      if (!r) return
      const len = r.data.length
      const off = frame - r.startFrame
      const from = Math.max(0, -off)
      const to = Math.min(data.length, len - off)
      if (to > from) {
        r.data.set(data.subarray(from, to), off + from)
        r.filled = off + to
      }
      if (off + data.length >= len) finish(i, r)
    })
  }

  function finish(i: number, r: Rec) {
    const c = ctx!
    const buf = c.createBuffer(1, r.data.length, c.sampleRate)
    buf.copyToChannel(r.data as Float32Array<ArrayBuffer>, 0)
    buffers[i] = buf
    peaks[i] = null
    recs[i] = null
    syncWorklet()
    startSource(i, c.currentTime + 0.02)
    setTrack(i, { status: 'recorded' })
  }

  function dropTrack(i: number) {
    stopSource(i)
    buffers[i] = null
    peaks[i] = null
  }

  function stopAll() {
    clearInterval(timer)
    timer = undefined
    stopClicks()
    for (let i = 0; i < n; i++) {
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
    // Idempotente por recurso: pode rodar de novo quando o stream chega depois do dispose.
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
      const master = c.createGain()
      master.connect(c.destination)
      const g = Array.from({ length: n }, () => {
        const node = c!.createGain()
        node.connect(master)
        return node
      })
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
      gains = g
      for (let i = 0; i < n; i++) applyGain(i)
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
    const next = { ...state, ...patch }
    set({ ...patch, loopDuration: loopDuration(next.bpm, next.bars) })
    // sem faixas, só o metrônomo depende de t0: reancora a grade
    if (state.playing && ctx) {
      stopClicks()
      t0 = ctx.currentTime + 0.05
      nextBeat = 0
    }
    return true
  }

  function clear(i: number) {
    if (!valid(i)) return
    if (recs[i]) cancelRec(i)
    dropTrack(i)
    if (state.tracks[i].status !== 'empty') setTrack(i, { status: 'empty' })
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
      for (let i = 0; i < n; i++) dropTrack(i)
      set({ status: 'disposed', tracks: state.tracks.map((t) => ({ ...t, status: 'empty' as const })) })
      listeners.clear()
    },

    setBpm: (bpm) => setTiming({ bpm: Math.min(180, Math.max(60, Math.round(bpm))) }),
    setBars: (bars) => setTiming({ bars }),
    setMetronome(metronome) {
      if (ready() && metronome !== state.metronome) set({ metronome })
    },
    setLatencyOffset(ms) {
      if (ready()) set({ latencyOffset: Math.min(200, Math.max(-200, ms)) })
    },

    play() {
      if (!ready() || state.playing) return
      void resume()
      startTransport(false)
    },
    stop() {
      if (ready()) stopAll()
    },

    record(i) {
      if (!valid(i)) return
      const c = ctx!
      void resume()
      if (recs[i]) return cancelRec(i)
      dropTrack(i) // descarta o take antigo ao armar (evita vazar no microfone)
      if (!state.playing) startTransport(true)
      const sr = c.sampleRate
      const latency = captureLatency(outLatency(), inputLatency, state.latencyOffset)
      const start = recordStart(c.currentTime, t0, state.loopDuration, latency)
      recs[i] = {
        start,
        startFrame: timeToFrame(start, sr, latency),
        data: new Float32Array(Math.ceil(state.loopDuration * sr)),
        filled: 0,
      }
      syncWorklet()
      setTrack(i, { status: 'armed' })
    },

    clear,
    clearAll() {
      if (!ready()) return
      stopAll()
      for (let i = 0; i < n; i++) dropTrack(i)
      if (locked()) set({ tracks: state.tracks.map((t) => ({ ...t, status: 'empty' as const })) })
    },

    setVolume(i, volume) {
      if (!valid(i)) return
      setTrack(i, { volume: Math.min(1, Math.max(0, volume)) })
      applyGain(i)
    },
    setMute(i, muted) {
      if (!valid(i)) return
      setTrack(i, { muted })
      applyGain(i)
    },

    getPosition() {
      if (!ctx || !state.playing) return STOPPED
      return { playing: true, ...positionAt(heardTime(ctx.currentTime, outLatency()), t0, state.bpm, state.bars) }
    },

    getPeaks(i, count) {
      if (!(i >= 0 && i < n) || count <= 0) return null
      const r = recs[i]
      // gravando: picos parciais sobre a duração total, resto zero (sem cache, cresce ao vivo)
      if (r) return r.filled > 0 ? computePeaks(r.data.subarray(0, r.filled), count, r.data.length) : null
      const buf = buffers[i]
      if (!buf) return null
      const cached = peaks[i]
      if (cached?.count === count) return cached.data
      const data = computePeaks(buf.getChannelData(0), count, buf.length)
      peaks[i] = { count, data }
      return data
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
