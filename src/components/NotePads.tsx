import { useEffect, useRef, useState } from 'react'
import type { Key, LoopEngine } from '../audio/types'
import { NOTE_PADS } from '../audio/types'
import { pentatonic } from '../audio/scale'
import { useEngine, useEngineState } from '../hooks/useEngine'

const targets = new WeakMap<LoopEngine, number>()
export const rememberOcarina = (engine: LoopEngine, track: number) => { targets.set(engine, track) }
export const lastOcarina = (engine: LoopEngine) => targets.get(engine)
export const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si']
export const keyName = (key: Key) => NOTE_NAMES[['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(key)]

export function NotePads({ track }: { track: number }) {
  const engine = useEngine()
  const { key, status } = useEngineState(engine)
  const held = useRef(new Map<string, number>())
  const [pressed, setPressed] = useState<number[]>([])
  const notes = pentatonic(key).slice(0, NOTE_PADS)
  function start(id: string, degree: number) {
    if (held.current.has(id)) return
    rememberOcarina(engine, track)
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
  }, [engine, track])
  return (
    <div className="note-pads" data-track={track} role="group" aria-label={`Notas da ocarina, faixa ${track + 1}`}>
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
          onBlur={() => stop(`b${degree}`)}>{name}<small>{octave}</small></button>
      })}
    </div>
  )
}
