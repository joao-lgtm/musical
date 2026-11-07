import { midiToHz } from './scale'

export interface Note {
  time: number
  duration: number
  midi: number
}
export interface Voice {
  stop(when: number, release?: number): void
}
const MIN_NOTE_DURATION = 0.09
const ATTACK = 0.025
const RELEASE = 0.06
const LEVEL = 0.24
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
export function noteWindow(note: Note, loopDuration: number) {
  if (![note.time, note.duration, note.midi, loopDuration].every(Number.isFinite) || note.duration < 0) return null
  const start = Math.max(0, note.time)
  const end = Math.min(loopDuration, note.time + Math.max(MIN_NOTE_DURATION, note.duration) + RELEASE)
  if (end <= start) return null
  const release = Math.min(RELEASE, (loopDuration - start) / 2, end - start)
  return { start, releaseAt: end - release, release, end }
}

export function startVoice(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number): Voice {
  const start = Math.max(ctx.currentTime, when)
  const fundamental = ctx.createOscillator()
  const harmonic = ctx.createOscillator()
  const overtone = ctx.createGain()
  const noise = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const air = ctx.createGain()
  const vibrato = ctx.createOscillator()
  const depth = ctx.createGain()
  const envelope = ctx.createGain()
  const frequency = midiToHz(midi)
  fundamental.type = harmonic.type = vibrato.type = 'sine'
  fundamental.frequency.value = frequency
  harmonic.frequency.value = frequency * 2
  overtone.gain.value = 0.08
  noise.buffer = breath(ctx)
  noise.loop = true
  filter.type = 'bandpass'
  filter.frequency.value = Math.min(frequency * 3, ctx.sampleRate * 0.4)
  filter.Q.value = 0.8
  air.gain.value = 0.035
  vibrato.frequency.value = 5
  depth.gain.setValueAtTime(0, start)
  depth.gain.setValueAtTime(0, start + 0.15)
  depth.gain.linearRampToValueAtTime(9, start + 0.25)
  vibrato.connect(depth)
  depth.connect(fundamental.detune)
  depth.connect(harmonic.detune)
  fundamental.connect(envelope)
  harmonic.connect(overtone).connect(envelope)
  noise.connect(filter).connect(air).connect(envelope)
  envelope.connect(dest)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(LEVEL, start + ATTACK)
  const sources = [fundamental, harmonic, noise, vibrato]
  const nodes = [...sources, overtone, filter, air, depth, envelope]
  let ended = 0
  let stopped = false
  sources.forEach((source) => {
    source.onended = () => {
      if (++ended === sources.length) nodes.forEach((node) => node.disconnect())
    }
    source.start(start)
  })
  return {
    stop(when, release) {
      if (stopped) return
      stopped = true
      // Release explícito permite cortar vozes roubadas e respeitar a borda do loop.
      const at = Math.max(start + (release === undefined ? MIN_NOTE_DURATION : 0), ctx.currentTime, when)
      const tail = Math.max(0, release ?? RELEASE)
      envelope.gain.cancelScheduledValues(at)
      if (at < start + ATTACK) envelope.gain.linearRampToValueAtTime(LEVEL * (at - start) / ATTACK, at)
      else envelope.gain.setValueAtTime(LEVEL, at)
      envelope.gain.linearRampToValueAtTime(0, at + tail)
      sources.forEach((source) => source.stop(at + tail))
    },
  }
}

export async function renderNotes(notes: readonly Note[], loopDuration: number, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(loopDuration * sampleRate)), sampleRate)
  for (const note of notes) {
    const window = noteWindow(note, loopDuration)
    if (!window) continue
    const voice = startVoice(ctx, ctx.destination, note.midi, window.start)
    voice.stop(window.releaseAt, window.release)
  }
  return ctx.startRendering()
}
