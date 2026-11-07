import type { Instrument, Key, LoopEngine } from '../audio/types'
import { DRUM_PRESETS, toPattern } from './drumPresets'

export interface StylePreset { name: string; bpm: number; drums: string; key: Key; instrument: Instrument }
export const STYLES: readonly StylePreset[] = [
  { name: 'Lo-fi', bpm: 80, drums: 'Boom bap', key: 'A', instrument: 'kalimba' },
  { name: 'Funk', bpm: 104, drums: 'Funk', key: 'E', instrument: 'bass' },
  { name: 'Reggaeton', bpm: 92, drums: 'Reggaeton', key: 'G', instrument: 'flute' },
  { name: 'Pop', bpm: 110, drums: 'Pop', key: 'C', instrument: 'ocarina' },
]
const pending = new WeakMap<LoopEngine, StylePreset>()
export function takeStyleAnnouncement(engine: LoopEngine) {
  const style = pending.get(engine)
  pending.delete(engine)
  return style
}
export function applyStyle(engine: LoopEngine, style: StylePreset) {
  const state = engine.getState()
  if (state.status !== 'ready' || state.tracks.some((t) => t.status !== 'empty') || state.pattern.some((row) => row.some(Boolean))) return
  const preset = DRUM_PRESETS.find((p) => p.name === style.drums)
  if (!preset) return
  engine.setBpm(style.bpm)
  engine.setKey(style.key)
  engine.setPattern(toPattern(preset))
  engine.setTrack(state.tracks.length - 1, { volume: 0.6 })
  engine.setTrack(0, { source: style.instrument })
  pending.set(engine, style)
  window.dispatchEvent(new Event('loopstudio:style'))
  engine.play()
}
