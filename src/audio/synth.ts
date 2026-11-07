import { midiToHz } from './scale'
import type { Instrument } from './types'

export interface Note {
  time: number
  duration: number
  midi: number
}
export interface Voice {
  onEnded(callback: () => void): void
  stop(when: number, release?: number): void
}
const MIN_NOTE_DURATION = 0.09
interface Partial {
  ratio: number
  level: number
  cents?: number
  decay?: number
}
interface Preset {
  partials: Partial[]
  attack: number
  release: number
  level: number
  cutoff: number
  glide?: number
  decay?: number
  filterEnvelope?: { peak: number; sustain: number; duration: number }
  breath?: { ratio: number; air: number; chiff: number; duration: number }
  vibrato?: { delay: number; full: number; depth: number }
}
const PRESETS: Record<Instrument, Preset> = {
  ocarina: {
    partials: [{ ratio: 1, level: 1 }, { ratio: 2, level: 0.02 }, { ratio: 3, level: 0.04 }, { ratio: 1, level: 0.1, cents: 4 }],
    attack: 0.03, release: 0.09, level: 0.2, cutoff: 3500, glide: 25,
    breath: { ratio: 2, air: 0.008, chiff: 0.05, duration: 0.04 },
    vibrato: { delay: 0.15, full: 0.5, depth: 12 },
  },
  flute: {
    partials: [{ ratio: 1, level: 1 }, { ratio: 2, level: 0.12 }, { ratio: 3, level: 0.025 }, { ratio: 1, level: 0.06, cents: 4 }],
    attack: 0.06, release: 0.12, level: 0.18, cutoff: 5000, glide: 15,
    breath: { ratio: 2, air: 0.035, chiff: 0.06, duration: 0.05 },
    vibrato: { delay: 0.12, full: 0.4, depth: 12 },
  },
  kalimba: {
    partials: [{ ratio: 1, level: 1 }, { ratio: 5.4, level: 0.15, decay: 0.3 }, { ratio: 8.9, level: 0.07, decay: 0.15 }],
    attack: 0.003, release: 0.01, level: 0.18, cutoff: 8500, decay: 1.5,
    breath: { ratio: 6, air: 0, chiff: 0.08, duration: 0.012 },
  },
  bass: {
    partials: [{ ratio: 1, level: 1 }, { ratio: 2, level: 0.22 }, { ratio: 3, level: 0.08 }],
    attack: 0.008, release: 0.08, level: 0.17, cutoff: 500,
    filterEnvelope: { peak: 2200, sustain: 500, duration: 0.15 },
  },
}
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function breath(ctx: BaseAudioContext) {
  let buffer = noiseCache.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, buffer)
  }
  return buffer
}

/** Janela finita: reserva o release antes do fim do loop, sem dar a volta. */
export function noteWindow(note: Note, loopDuration: number, instrument: Instrument = 'ocarina') {
  const preset = PRESETS[instrument]
  if (![note.time, note.duration, note.midi, loopDuration].every(Number.isFinite) || note.duration < 0) return null
  const start = Math.max(0, note.time)
  const end = Math.min(loopDuration, note.time + (preset.decay ?? Math.max(MIN_NOTE_DURATION, note.duration)) + preset.release)
  if (end <= start) return null
  const release = Math.min(preset.release, (loopDuration - start) / 2, end - start)
  return { start, releaseAt: end - release, release, end }
}

export function startVoice(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, instrument: Instrument = 'ocarina'): Voice {
  const preset = PRESETS[instrument]
  const start = Math.max(ctx.currentTime, when)
  const frequency = midiToHz(midi)
  const tones = preset.partials.map(() => ctx.createOscillator())
  const gains = preset.partials.slice(1).map(() => ctx.createGain())
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [...tones]
  const nodes: AudioNode[] = [...tones, ...gains]
  const inputs: AudioNode[] = [tones[0]]
  tones.forEach((tone, i) => {
    const partial = preset.partials[i]
    tone.type = 'sine'
    tone.frequency.value = frequency * partial.ratio
    const cents = partial.cents ?? 0
    tone.detune.setValueAtTime(cents - (preset.glide ?? 0), start)
    if (preset.glide) tone.detune.linearRampToValueAtTime(cents, start + 0.05)
    if (i) {
      const gain = gains[i - 1]
      gain.gain.value = partial.level
      if (partial.decay) {
        gain.gain.setValueAtTime(partial.level, start)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay)
      }
      tone.connect(gain)
      inputs.push(gain)
    }
  })
  if (preset.breath) {
    const noise = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const air = ctx.createGain()
    const chiff = ctx.createGain()
    noise.buffer = breath(ctx)
    noise.loop = true
    filter.type = 'bandpass'
    filter.frequency.value = Math.min(frequency * preset.breath.ratio, ctx.sampleRate * 0.4)
    filter.Q.value = 0.7
    air.gain.value = preset.breath.air
    chiff.gain.setValueAtTime(preset.breath.chiff, start)
    chiff.gain.linearRampToValueAtTime(0, start + preset.breath.duration)
    noise.connect(filter)
    filter.connect(air)
    filter.connect(chiff)
    inputs.push(air, chiff)
    sources.push(noise)
    nodes.push(noise, filter, air, chiff)
  }
  if (preset.vibrato) {
    const vibrato = ctx.createOscillator()
    const depth = ctx.createGain()
    const drift = ctx.createOscillator()
    const driftDepth = ctx.createGain()
    vibrato.type = drift.type = 'sine'
    vibrato.frequency.value = 5.2
    drift.frequency.value = 0.23
    driftDepth.gain.value = 0.12
    drift.connect(driftDepth).connect(vibrato.frequency)
    depth.gain.setValueAtTime(0, start)
    depth.gain.setValueAtTime(0, start + preset.vibrato.delay)
    depth.gain.linearRampToValueAtTime(preset.vibrato.depth, start + preset.vibrato.full)
    vibrato.connect(depth)
    tones.forEach(tone => depth.connect(tone.detune))
    sources.push(vibrato, drift)
    nodes.push(vibrato, depth, drift, driftDepth)
  }
  const envelope = ctx.createGain()
  const output = ctx.createBiquadFilter()
  output.type = 'lowpass'
  output.frequency.value = Math.min(preset.cutoff, ctx.sampleRate * 0.45)
  output.Q.value = 0.5
  if (preset.filterEnvelope) {
    output.frequency.setValueAtTime(Math.min(preset.filterEnvelope.peak, ctx.sampleRate * 0.45), start)
    output.frequency.exponentialRampToValueAtTime(Math.min(preset.filterEnvelope.sustain, ctx.sampleRate * 0.45), start + preset.filterEnvelope.duration)
  }
  inputs.forEach(input => input.connect(envelope))
  envelope.connect(output).connect(dest)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(preset.level, start + preset.attack)
  nodes.push(envelope, output)
  let ended = 0
  let finished = false
  const listeners = new Set<() => void>()
  let stopped = false
  let forced = false
  let releaseStart = Infinity
  let releaseEnd = Infinity
  let releaseLevel = 0
  sources.forEach(source => {
    source.onended = () => {
      if (++ended === sources.length) {
        finished = true
        nodes.forEach(node => node.disconnect())
        listeners.forEach(callback => callback())
        listeners.clear()
      }
    }
    source.start(start)
  })
  const naturalEnd = start + (preset.decay ?? 0) + preset.release
  if (preset.decay) {
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + preset.decay)
    envelope.gain.linearRampToValueAtTime(0, naturalEnd)
    sources.forEach(source => source.stop(naturalEnd))
  }
  return {
    onEnded(callback) {
      if (finished) callback()
      else listeners.add(callback)
    },
    stop(when, release) {
      if (finished || forced || (stopped || preset.decay) && release === undefined) return
      stopped = true
      forced = release !== undefined
      // Release explicito corta roubo de voz e a borda do loop, inclusive na kalimba.
      const at = Math.max(start + (release === undefined ? MIN_NOTE_DURATION : 0), ctx.currentTime, when)
      const tail = Math.max(0, release ?? preset.release)
      envelope.gain.cancelScheduledValues(at)
      const elapsed = at - start
      const level = at >= releaseStart ? releaseLevel * Math.max(0, (releaseEnd - at) / (releaseEnd - releaseStart))
        : elapsed < preset.attack ? preset.level * elapsed / preset.attack : preset.decay
        ? preset.level * Math.pow(0.0001 / preset.level, (elapsed - preset.attack) / (preset.decay - preset.attack)) : preset.level
      if (elapsed < preset.attack || at >= releaseStart) envelope.gain.linearRampToValueAtTime(level, at)
      else envelope.gain.setValueAtTime(level, at)
      envelope.gain.linearRampToValueAtTime(0, at + tail)
      releaseStart = at
      releaseEnd = at + tail
      releaseLevel = level
      sources.forEach(source => source.stop(releaseEnd))
    },
  }
}

export async function renderNotes(notes: readonly Note[], loopDuration: number, sampleRate: number, instrument: Instrument = 'ocarina'): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(loopDuration * sampleRate)), sampleRate)
  for (const note of notes) {
    const window = noteWindow(note, loopDuration, instrument)
    if (!window) continue
    const voice = startVoice(ctx, ctx.destination, note.midi, window.start, instrument)
    const decay = PRESETS[instrument].decay
    if (!decay || window.end < window.start + decay + PRESETS[instrument].release) {
      voice.stop(window.releaseAt, window.release)
    }
  }
  return ctx.startRendering()
}
