import type { DrumVoice } from './types'

// Um buffer de ruído branco (1 s) por contexto
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx)
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, b)
  }
  return b
}

/** Envelope exponencial: ataque curto até `peak`, queda até ~0 em `decay` s. */
function envGain(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(peak, when + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay)
  g.connect(dest)
  return g
}

/** Liga a fonte ao resto da cadeia, toca e desconecta tudo no fim. */
function fire(src: AudioScheduledSourceNode, chain: AudioNode[], when: number, dur: number) {
  src.connect(chain[0])
  src.onended = () => [src, ...chain].forEach((n) => n.disconnect())
  src.start(when)
  src.stop(when + dur)
}

function noise(ctx: BaseAudioContext, dest: AudioNode, when: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = envGain(ctx, dest, when, peak, decay)
  f.connect(g)
  fire(src, [f, g], when, decay + 0.01)
}

function tone(ctx: BaseAudioContext, dest: AudioNode, when: number, from: number, to: number, sweep: number, peak: number, decay: number) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(from, when)
  osc.frequency.exponentialRampToValueAtTime(to, when + sweep)
  const g = envGain(ctx, dest, when, peak, decay)
  fire(osc, [g], when, decay + 0.01)
}

export function playDrum(ctx: BaseAudioContext, dest: AudioNode, voice: DrumVoice, when: number): void {
  switch (voice) {
    case 'kick':
      tone(ctx, dest, when, 150, 45, 0.08, 1, 0.45)
      break
    case 'snare':
      noise(ctx, dest, when, 'highpass', 1000, 0.7, 0.7, 0.18)
      tone(ctx, dest, when, 180, 160, 0.05, 0.5, 0.1)
      break
    case 'hat':
      noise(ctx, dest, when, 'highpass', 7000, 0.7, 0.4, 0.05)
      break
    case 'clap':
      // 3 rajadas espaçadas ~10 ms + cauda
      for (let i = 0; i < 3; i++) noise(ctx, dest, when + i * 0.01, 'bandpass', 1500, 1.5, 0.8, 0.02)
      noise(ctx, dest, when + 0.03, 'bandpass', 1500, 1.5, 0.6, 0.2)
      break
  }
}
