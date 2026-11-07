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
const ATTACK = 0.03
const RELEASE = 0.09
const LEVEL = 0.20
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
  const second = ctx.createOscillator()
  const third = ctx.createOscillator()
  const body = ctx.createOscillator()
  const secondGain = ctx.createGain()
  const thirdGain = ctx.createGain()
  const bodyGain = ctx.createGain()
  const noise = ctx.createBufferSource()
  const breathFilter = ctx.createBiquadFilter()
  const air = ctx.createGain()
  const chiff = ctx.createGain()
  const vibrato = ctx.createOscillator()
  const depth = ctx.createGain()
  const drift = ctx.createOscillator()
  const driftDepth = ctx.createGain()
  const envelope = ctx.createGain()
  const output = ctx.createBiquadFilter()
  const frequency = midiToHz(midi)
  const tones = [fundamental, second, third, body]
  tones.forEach((tone, i) => {
    tone.type = 'sine'
    tone.frequency.value = frequency * [1, 2, 3, 1][i]
    const cents = tone === body ? 4 : 0
    tone.detune.setValueAtTime(cents - 25, start)
    tone.detune.linearRampToValueAtTime(cents, start + 0.05)
    depth.connect(tone.detune)
  })
  secondGain.gain.value = 0.02
  thirdGain.gain.value = 0.04
  bodyGain.gain.value = 0.10
  fundamental.connect(envelope)
  second.connect(secondGain).connect(envelope)
  third.connect(thirdGain).connect(envelope)
  body.connect(bodyGain).connect(envelope)
  noise.buffer = breath(ctx)
  noise.loop = true
  breathFilter.type = 'bandpass'
  breathFilter.frequency.value = Math.min(frequency * 2, ctx.sampleRate * 0.4)
  breathFilter.Q.value = 0.7
  air.gain.value = 0.008
  chiff.gain.setValueAtTime(0.05, start)
  chiff.gain.linearRampToValueAtTime(0, start + 0.04)
  noise.connect(breathFilter)
  breathFilter.connect(air).connect(envelope)
  breathFilter.connect(chiff).connect(envelope)
  vibrato.type = drift.type = 'sine'
  vibrato.frequency.value = 5.2
  drift.frequency.value = 0.23
  driftDepth.gain.value = 0.12
  drift.connect(driftDepth).connect(vibrato.frequency)
  depth.gain.setValueAtTime(0, start)
  depth.gain.setValueAtTime(0, start + 0.15)
  depth.gain.linearRampToValueAtTime(12, start + 0.5)
  vibrato.connect(depth)
  output.type = 'lowpass'
  output.frequency.value = Math.min(3500, ctx.sampleRate * 0.45)
  output.Q.value = 0.5
  envelope.connect(output).connect(dest)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(LEVEL, start + ATTACK)
  const sources = [...tones, noise, vibrato, drift]
  const nodes = [...sources, secondGain, thirdGain, bodyGain, breathFilter, air, chiff,
    depth, driftDepth, envelope, output]
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
