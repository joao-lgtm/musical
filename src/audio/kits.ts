import { playDrum } from './drums'

import { DRUM_SLOTS } from './types'
import type { KitId, SlotRole } from './types'
export type KitVoice = 'kick' | 'snare' | 'hat' | 'clap' | 'openHat' | 'tom' | 'cymbal' | 'shaker' |
  'kick808' | 'snare808' | 'tom808' | 'cowbell' | 'rimshot' |
  'surdo' | 'repique' | 'pandeiro' | 'tamborim' | 'tanta' | 'agogo' | 'ganza'

const acoustic = [
  { name: 'Bumbo', voice: 'kick', role: 'kick' }, { name: 'Caixa', voice: 'snare', role: 'snare' },
  { name: 'Chimbal', voice: 'hat', role: 'hat' }, { name: 'Palmas', voice: 'clap', role: 'perc' },
  { name: 'Chimbal aberto', voice: 'openHat', role: 'hat' }, { name: 'Tom', voice: 'tom', role: 'perc' },
  { name: 'Prato', voice: 'cymbal', role: 'perc' }, { name: 'Shaker', voice: 'shaker', role: 'hat' },
] satisfies { name: string; voice: KitVoice; role: SlotRole }[]

export const KITS: Record<KitId, { label: string; slots: { name: string; voice: KitVoice; role: SlotRole }[] }> = {
  acoustic: { label: 'Acústico', slots: acoustic },
  '808': { label: '808', slots: [
    { name: 'Bumbo 808', voice: 'kick808', role: 'kick' }, { name: 'Caixa 808', voice: 'snare808', role: 'snare' },
    { name: 'Chimbal fechado', voice: 'hat', role: 'hat' }, { name: 'Palmas', voice: 'clap', role: 'perc' },
    { name: 'Chimbal aberto', voice: 'openHat', role: 'hat' }, { name: 'Tom 808', voice: 'tom808', role: 'perc' },
    { name: 'Cowbell', voice: 'cowbell', role: 'perc' }, { name: 'Rimshot', voice: 'rimshot', role: 'perc' },
  ] },
  roda: { label: 'Roda', slots: [
    { name: 'Surdo', voice: 'surdo', role: 'kick' }, { name: 'Caixa de roda/repique', voice: 'repique', role: 'snare' },
    { name: 'Pandeiro', voice: 'pandeiro', role: 'hat' }, { name: 'Tamborim', voice: 'tamborim', role: 'perc' },
    { name: 'Tantã', voice: 'tanta', role: 'perc' }, { name: 'Agogô', voice: 'agogo', role: 'perc' },
    { name: 'Ganzá', voice: 'ganza', role: 'hat' }, { name: 'Palmas', voice: 'clap', role: 'perc' },
  ] },
  lofi: { label: 'Lo-fi', slots: acoustic.map(slot => ({ ...slot })) },
}

export function slotRole(kit: KitId, slot: number): SlotRole {
  return KITS[kit].slots[slot]?.role ?? 'perc'
}

const noises = new WeakMap<BaseAudioContext, AudioBuffer>()
const saturation = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 1023 * 2 - 1) * 1.7) / Math.tanh(1.7))

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noises.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    noises.set(ctx, buffer)
  }
  return buffer
}

export function playKitVoice(ctx: BaseAudioContext, dest: AudioNode, kit: KitId, slot: number, when: number, velocity = 1): void {
  velocity = Number.isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 0
  if (!velocity || !Number.isInteger(slot) || slot < 0 || slot >= DRUM_SLOTS) return
  const voice = KITS[kit].slots[slot].voice
  if ((kit === 'acoustic' || kit === 'roda') && (voice === 'kick' || voice === 'snare' || voice === 'hat' || voice === 'clap')) {
    playDrum(ctx, dest, voice, when, velocity)
    return
  }
  function filter(type: BiquadFilterType, frequency: number, q = 0.7) {
    const node = ctx.createBiquadFilter()
    node.type = type; node.frequency.value = frequency; node.Q.value = q
    return node
  }
  function fire(source: AudioScheduledSourceNode, filters: AudioNode[], start: number, peak: number, decay: number) {
    if (kit === 'lofi') {
      const shaper = ctx.createWaveShaper()
      shaper.curve = saturation
      filters.push(shaper, filter('lowpass', 5000))
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak * velocity, start + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay)
    const nodes = [source, ...filters, gain]
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    gain.connect(dest)
    source.onended = () => nodes.forEach(node => node.disconnect())
    source.start(start)
    source.stop(start + decay + 0.01)
  }
  function noise(type: BiquadFilterType, frequency: number, peak: number, decay: number, start = when) {
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    fire(source, [filter(type, frequency)], start, peak, decay)
  }
  function tone(from: number, to: number, sweep: number, peak: number, decay: number, type: OscillatorType = 'sine', band?: number, filterType: BiquadFilterType = 'bandpass') {
    const source = ctx.createOscillator()
    source.type = type
    source.frequency.setValueAtTime(from, when)
    source.frequency.exponentialRampToValueAtTime(to, when + sweep)
    fire(source, band ? [filter(filterType, band, 1.5)] : [], when, peak, decay)
  }
  switch (voice) {
    case 'surdo': tone(85, 58, 0.07, 0.95, 0.55, 'sine', 650, 'lowpass'); break
    case 'repique':
      noise('highpass', 1500, 0.45, 0.08); tone(330, 260, 0.035, 0.3, 0.09, 'triangle'); break
    case 'pandeiro':
      noise('highpass', 6500, 0.3, 0.1); tone(340, 280, 0.025, 0.2, 0.055); break
    case 'tamborim':
      tone(850, 780, 0.015, 0.5, 0.06, 'triangle'); noise('bandpass', 2400, 0.15, 0.025); break
    case 'tanta': tone(115, 90, 0.045, 0.75, 0.18, 'sine', 900, 'lowpass'); break
    case 'agogo':
      tone(600, 600, 0.01, 0.23, 0.22, 'triangle', 1200)
      tone(900, 900, 0.01, 0.2, 0.18, 'triangle', 1500); break
    case 'ganza': noise('bandpass', 4500, 0.35, 0.11); break
    case 'kick': tone(150, 45, 0.08, 1, 0.45); break
    case 'kick808': tone(160, 42, 0.12, 0.95, 1.2); break
    case 'snare':
      noise('highpass', 1000, 0.7, 0.18); tone(180, 160, 0.05, 0.5, 0.1); break
    case 'snare808':
      noise('highpass', 1800, 0.65, 0.22); tone(190, 150, 0.04, 0.35, 0.12, 'triangle'); break
    case 'hat': noise('highpass', kit === '808' ? 8500 : 7000, 0.4, 0.05); break
    case 'clap':
      for (let i = 0; i < 3; i++) noise('bandpass', 1500, 0.8, 0.02, when + i * 0.01)
      noise('bandpass', 1500, 0.6, 0.2, when + 0.03); break
    case 'openHat': noise('highpass', 6500, 0.4, 0.35); break
    case 'tom': tone(190, 120, 0.08, 0.7, 0.25); break
    case 'tom808': tone(170, 100, 0.12, 0.75, 0.45); break
    case 'cymbal': noise('highpass', 5000, 0.5, 1.2); break
    case 'shaker': noise('bandpass', 5500, 0.4, 0.07); break
    case 'cowbell':
      tone(540, 540, 0.01, 0.23, 0.18, 'square', 800)
      tone(800, 800, 0.01, 0.23, 0.18, 'square', 800); break
    case 'rimshot':
      noise('bandpass', 2500, 0.45, 0.012); tone(1800, 1200, 0.015, 0.35, 0.04); break
  }
}
