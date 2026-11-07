import { useEffect, useRef, useState } from 'react'
import type { Key, LoopEngine, PadScale } from '../audio/types'
import { PAD_COUNT, PAD_SCALES, INSTRUMENT_LABEL, INSTRUMENT_OCTAVE, isInstrument } from '../audio/types'
import type { Chord } from '../audio/harmony'
import { KEYS } from '../audio/types'
import { padNotes } from '../audio/scale'
import { useEngine, useEngineState } from '../hooks/useEngine'

export const NOTE_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
const NOTE_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç']

export interface CoachGuidance { track: number; phase: 'bass' | 'harmony' | 'melody'; chords: Chord[] }
const guidance = new WeakMap<LoopEngine, CoachGuidance>()
export function setCoachGuidance(engine: LoopEngine, value: CoachGuidance | null) {
  if (value) guidance.set(engine, value)
  else guidance.delete(engine)
  window.dispatchEvent(new Event('loopstudio:coach-notes'))
}
export function chordPitches(chord: Chord, harmony: boolean) {
  const root = KEYS.findIndex((key) => key === chord.name.replace(/m$/, ''))
  return harmony ? [root, (root + (chord.name.endsWith('m') ? 3 : 4)) % 12] : [root]
}
const targets = new WeakMap<LoopEngine, number>()
export const rememberInstrument = (engine: LoopEngine, track: number) => { targets.set(engine, track) }
export const lastInstrument = (engine: LoopEngine) => targets.get(engine)
export const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si']
export const keyName = (key: Key) => NOTE_NAMES[['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(key)]

export function NotePads({ track }: { track: number }) {
  const engine = useEngine()
  const { key, scale, status, tracks } = useEngineState(engine)
  const source = tracks[track].source
  const instrument = isInstrument(source) ? source : 'ocarina'
  const padRoot = useRef<HTMLDivElement>(null)
  const [coach, setCoach] = useState<CoachGuidance | null>(null)
  useEffect(() => {
    const update = () => { const value = guidance.get(engine); setCoach(value?.track === track ? value : null) }
    window.addEventListener('loopstudio:coach-notes', update)
    update()
    return () => window.removeEventListener('loopstudio:coach-notes', update)
  }, [engine, track])
  useEffect(() => {
    if (!coach || coach.phase === 'melody') return
    let frame = 0
    const buttons = padRoot.current?.querySelectorAll<HTMLButtonElement>('[data-degree]')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      const pos = engine.getPosition()
      const snapshot = engine.getState()
      const playing = snapshot.tracks[track]?.status === 'recording' && pos.playing && !pos.countIn
      const at = pos.phase * snapshot.bars * 16
      const chord = coach.chords.find((c) => at >= c.step && at < c.step + c.length)
      const pitches = playing && chord ? chordPitches(chord, coach.phase === 'harmony') : []
      const midis = padNotes(snapshot.key, snapshot.scale, INSTRUMENT_OCTAVE[instrument])
      const growth = reduced.matches ? 1 : 0.2 + 0.8 * ((pos.phase * snapshot.bars * (coach.phase === 'harmony' ? 2 : 1)) % 1)
      buttons?.forEach((button, degree) => {
        if (pitches.includes(midis[degree] % 12)) {
          button.setAttribute('data-coach-note', '')
          button.style.setProperty('--coach-grow', String(growth))
        } else { button.removeAttribute('data-coach-note'); button.style.removeProperty('--coach-grow') }
      })
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frame)
      buttons?.forEach((button) => { button.removeAttribute('data-coach-note'); button.style.removeProperty('--coach-grow') })
    }
  }, [engine, track, coach, instrument, key, scale])
  const held = useRef(new Map<string, number>())
  const [pressed, setPressed] = useState<number[]>([])
  const notes = padNotes(key, scale, INSTRUMENT_OCTAVE[instrument]).slice(0, PAD_COUNT[scale])
  function start(id: string, degree: number) {
    if (held.current.has(id)) return
    rememberInstrument(engine, track)
    if (![...held.current.values()].includes(degree)) engine.noteOn(track, degree)
    held.current.set(id, degree)
    setPressed([...held.current.values()])
  }
  function stop(id: string) {
    const degree = held.current.get(id)
    if (degree === undefined) return
    held.current.delete(id)
    if (![...held.current.values()].includes(degree)) engine.noteOff(track, degree)
    setPressed([...held.current.values()])
  }
  useEffect(() => {
    const notesHeld = held.current
    setPressed([])
    const release = () => {
      for (const degree of notesHeld.values()) engine.noteOff(track, degree)
      notesHeld.clear()
      setPressed([])
    }
    const visibility = () => { if (document.hidden) release() }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', visibility)
      for (const degree of notesHeld.values()) engine.noteOff(track, degree)
      notesHeld.clear()
    }
  }, [engine, track, key, scale, instrument])
  return (
    <div className="instrument-pads">
      <label className="pad-scale"><span className="field__label">Escala</span>
        <select aria-label={`Escala das notas, faixa ${track + 1}`} value={scale} onChange={(e) => engine.setScale(e.target.value as PadScale)}>
          {PAD_SCALES.map((value) => <option key={value} value={value}>{value === 'major' ? 'Maior (todas as notas)' : 'Pentatônica (nunca erra)'}</option>)}
        </select>
      </label>
    <div ref={padRoot} className="note-pads" data-scale={scale} data-track={track} role="group" aria-label={`Notas de ${INSTRUMENT_LABEL[instrument]}, faixa ${track + 1}`}>
      {notes.map((midi, degree) => {
        const name = NOTE_NAMES[midi % 12]
        const octave = Math.floor(midi / 12) - 1
        return <button key={degree} type="button" className="note-pad" data-degree={degree} disabled={status !== 'ready'}
          aria-label={`${name}, oitava ${octave}`} data-playing={pressed.includes(degree) || undefined}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); start(`p${e.pointerId}`, degree) }}
          onPointerUp={(e) => stop(`p${e.pointerId}`)} onPointerCancel={(e) => stop(`p${e.pointerId}`)}
          onLostPointerCapture={(e) => stop(`p${e.pointerId}`)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) { e.preventDefault(); start(`b${degree}`, degree) } }}
          onKeyUp={(e) => { if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); stop(`b${degree}`) } }}
          onBlur={() => stop(`b${degree}`)}><span>{name} {octave}</span><kbd className="note-pad__key" aria-hidden="true">{NOTE_KEYS[degree]}</kbd></button>
      })}
    </div>
    </div>
  )
}
