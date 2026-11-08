import type { Instrument, Key, KitId, LoopEngine } from '../audio/types'
import type { ProgressionStyle } from '../audio/harmony'
import { DRUM_PRESETS, toPattern } from './drumPresets'

export interface StylePreset { name: string; bpm: number; drums: string; key: Key; instrument: Instrument; kit: KitId; swing: number; progressionStyle: ProgressionStyle; group: 'Brasil' | 'Mundo' }
export const STYLES: readonly StylePreset[] = [
  { name: 'Lo-fi', bpm: 80, drums: 'Boom bap', key: 'A', instrument: 'kalimba', kit: 'lofi', swing: 0, progressionStyle: 'lofi', group: 'Mundo' },
  { name: 'Funk', bpm: 104, drums: 'Funk', key: 'E', instrument: 'bass', kit: 'acoustic', swing: 0, progressionStyle: 'funk', group: 'Mundo' },
  { name: 'Reggaeton', bpm: 92, drums: 'Reggaeton', key: 'G', instrument: 'flute', kit: 'acoustic', swing: 0, progressionStyle: 'reggaeton', group: 'Mundo' },
  { name: 'Pop', bpm: 110, drums: 'Pop', key: 'C', instrument: 'ocarina', kit: 'acoustic', swing: 0, progressionStyle: 'pop', group: 'Mundo' },
  { name: 'Pagode', bpm: 95, drums: 'Pagode', key: 'D', instrument: 'cavaquinho', kit: 'roda', swing: 0.12, progressionStyle: 'pagode', group: 'Brasil' },
  { name: 'Samba', bpm: 100, drums: 'Samba', key: 'C', instrument: 'cavaquinho', kit: 'roda', swing: 0.15, progressionStyle: 'samba', group: 'Brasil' },
  { name: 'Funk carioca', bpm: 130, drums: 'Funk carioca', key: 'A', instrument: 'bass', kit: '808', swing: 0.05, progressionStyle: 'funkcarioca', group: 'Brasil' },
]
const appliedStyles = new WeakMap<LoopEngine, StylePreset>()
export const getAppliedStyle = (engine: LoopEngine) => appliedStyles.get(engine)
export const rememberStyle = (engine: LoopEngine, style: StylePreset) => { appliedStyles.set(engine, style) }
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
  engine.setKit(style.kit)
  engine.setSwing(style.swing)
  engine.setBpm(style.bpm)
  engine.setKey(style.key)
  engine.setPattern(toPattern(preset))
  engine.setTrack(state.tracks.length - 1, { volume: 0.6 })
  engine.setTrack(0, { source: style.instrument })
  rememberStyle(engine, style)
  pending.set(engine, style)
  window.dispatchEvent(new Event('loopstudio:style'))
  engine.play()
}
