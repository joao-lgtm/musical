import { useEffect, useRef, useState } from 'react'
import type { Key, LoopEngine, PadScale } from '../audio/types'
import { PAD_COUNT, PAD_SCALES, INSTRUMENT_LABEL, INSTRUMENT_OCTAVE, isInstrument } from '../audio/types'
import { padNotes } from '../audio/scale'
import { useEngine, useEngineState } from '../hooks/useEngine'

export const NOTE_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
const NOTE_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç']

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
    <div className="note-pads" data-scale={scale} data-track={track} role="group" aria-label={`Notas de ${INSTRUMENT_LABEL[instrument]}, faixa ${track + 1}`}>
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
