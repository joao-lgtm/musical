import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { INSTRUMENT_OCTAVE, PAD_SCALES, isInstrument } from '../audio/types'
import type { GridNote, LoopEngine, PadScale } from '../audio/types'
import { padNotes, scalePitchClasses, snapToScale } from '../audio/scale'
import { chordPads } from '../audio/harmony'
import { useEngine, useEngineState, useFrame } from '../hooks/useEngine'
import { NOTE_NAMES } from './NotePads'

export const OPEN_GRID_EVENT = 'loopstudio:open-note-grid'
export const openNoteGrid = (engine: LoopEngine, track: number) => window.dispatchEvent(new CustomEvent(OPEN_GRID_EVENT, { detail: { engine, track } }))
const noteName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]} ${Math.floor(midi / 12) - 1}`

export function NoteGrid({ track }: { track: number }) {
  const engine = useEngine()
  const state = useEngineState(engine)
  const channel = state.tracks[track]
  const source = isInstrument(channel.source) ? channel.source : 'ocarina'
  const [notes, setNotes] = useState<GridNote[]>(() => [...(channel.notes ?? [])])
  const draft = useRef(notes)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(24)
  const [chromatic, setChromatic] = useState(false)
  const [cursor, setCursor] = useState({ midi: padNotes(state.key, state.scale, INSTRUMENT_OCTAVE[source])[0], step: 0 })
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingFlush = useRef<(() => void) | null>(null)
  const request = useRef(0)
  const appliedRevision = useRef(-1)
  const pending = useRef(false)
  const mounted = useRef(true)
  const root = useRef<HTMLDivElement>(null)
  const focusNext = useRef(false)
  const drag = useRef<{ id: number; midi: number; step: number; x: number; width: number; base: GridNote[]; existing?: GridNote; members: GridNote[]; moved: boolean } | null>(null)
  const total = state.bars * 16
  const currentPage = Math.min(page, state.bars - 1)
  const pads = padNotes(state.key, state.scale, INSTRUMENT_OCTAVE[source])
  const classes = scalePitchClasses(state.key, state.scale)
  const chordsMode = channel.padMode === 'chords'
  const chords = chordPads(state.key, INSTRUMENT_OCTAVE[source])
  const pitchesFor = (row: number) => chordsMode ? chords[-row - 1].midis : [row]
  const rowName = (row: number) => chordsMode ? `${chords[-row - 1].label} · ${chords[-row - 1].name}` : noteName(row)
  function membersFor(row: number, step: number, list: GridNote[]) {
    if (!chordsMode) {
      const note = list.find((n) => n.midi === row && n.step < step + 1 && n.step + n.length > step)
      return note ? [note] : []
    }
    const classes = pitchesFor(row).map((midi) => midi % 12)
    for (const note of list) {
      if (!(note.step < step + 1 && note.step + note.length > step)) continue
      const members = classes.map((pitch) => list.find((n) => n.midi % 12 === pitch && Math.abs(n.step - note.step) < 0.0001 && Math.abs(n.length - note.length) < 0.0001))
      if (members.every((n) => n !== undefined)) return members as GridNote[]
    }
    return []
  }
  const recognized = new Set<GridNote>()
  if (chordsMode) for (const note of notes) for (let i = 0; i < chords.length; i++) {
    for (const member of membersFor(-i - 1, Math.floor(note.step), notes)) recognized.add(member)
  }
  const loose = chordsMode ? notes.filter((n) => !recognized.has(n)).length : 0
  const outside = notes.filter((n) => !classes.includes(((n.midi % 12) + 12) % 12)).length
  const low = Math.min(...pads, ...notes.map((n) => n.midi))
  const high = Math.max(...pads, ...notes.map((n) => n.midi))
  const rows = chordsMode ? chords.map((_, i) => -i - 1) : chromatic ? Array.from({ length: high - low + 1 }, (_, i) => high - i)
    : [...new Set([...pads, ...notes.filter((n) => classes.includes(((n.midi % 12) + 12) % 12)).map((n) => n.midi)])].sort((a, b) => b - a)
  const disabled = state.status !== 'ready' || channel.status === 'armed' || channel.status === 'recording'
  useEffect(() => {
    if (!pending.current) { draft.current = [...(channel.notes ?? [])]; setNotes(draft.current) }
  }, [channel.notes, channel.revision])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current++
      clearTimeout(timer.current)
      pendingFlush.current?.()
      pendingFlush.current = null
    }
  }, [engine, track])
  function edit(next: GridNote[]) {
    if (disabled) return
    const snapshot = engine.getState()
    const revision = snapshot.tracks[track].revision
    const id = ++request.current
    draft.current = next
    setNotes(next)
    pending.current = true
    setSaving(true)
    setMessage('')
    clearTimeout(timer.current)
    const flush = async () => {
      pendingFlush.current = null
      const now = engine.getState()
      if (now.key !== snapshot.key || now.bars !== snapshot.bars || now.tracks[track]?.source !== snapshot.tracks[track].source ||
          (now.tracks[track]?.revision !== revision && now.tracks[track]?.revision !== appliedRevision.current)) {
        if (mounted.current && id === request.current) {
          pending.current = false; setSaving(false)
          draft.current = [...(now.tracks[track]?.notes ?? [])]; setNotes(draft.current)
          setMessage('A faixa mudou. Tente editar de novo.')
        }
        return
      }
      try {
        const ok = await engine.setTrackNotes(track, next)
        if (ok) appliedRevision.current = engine.getState().tracks[track].revision
        if (!mounted.current || id !== request.current) return
        pending.current = false
        if (!ok) {
          draft.current = [...(engine.getState().tracks[track]?.notes ?? [])]; setNotes(draft.current)
          setMessage('Não deu para aplicar agora. Tente de novo.')
        }
      } catch { if (mounted.current && id === request.current) { pending.current = false; setMessage('Não deu para editar. Tente de novo.') } }
      finally { if (mounted.current && id === request.current) setSaving(false) }
    }
    pendingFlush.current = () => { void flush() }
    timer.current = setTimeout(() => { void flush() }, 120)
  }
  function preview(row: number) {
    for (const midi of pitchesFor(row)) engine.previewNote(track, midi, 0.16)
  }
  const covering = (row: number, step: number, list = draft.current) => membersFor(row, step, list)[0]
  function toggle(row: number, step: number) {
    const members = membersFor(row, step, draft.current)
    edit(members.length ? draft.current.filter((n) => !members.includes(n))
      : [...draft.current, ...pitchesFor(row).map((midi) => ({ midi, step, length: Math.min(chordsMode ? 8 : 1, total - step) }))])
    preview(row)
  }
  function begin(event: PointerEvent<HTMLButtonElement>, midi: number, step: number) {
    if (event.button !== 0 || disabled) return
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
    setCursor({ midi, step })
    drag.current = { id: event.pointerId, midi, step, x: event.clientX, width: event.currentTarget.getBoundingClientRect().width + 2, base: [...draft.current], existing: covering(midi, step), members: membersFor(midi, step, draft.current), moved: false }
    preview(midi)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    if (!d || d.id !== event.pointerId || Math.abs(event.clientX - d.x) < 4) return
    d.moved = true
    const start = d.existing?.step ?? d.step
    const end = Math.min(total, Math.max(start + 1, d.step + Math.round((event.clientX - d.x) / d.width) + 1))
    const additions = d.members.length ? d.members.map((n) => ({ ...n, length: end - start }))
      : pitchesFor(d.midi).map((midi) => ({ midi, step: start, length: end - start }))
    edit([...d.base.filter((n) => !d.members.includes(n)), ...additions])
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    if (!cancel && !d.moved) toggle(d.midi, d.step)
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, midi: number, step: number) {
    if (event.key === 'Enter' || event.code === 'Space') { event.preventDefault(); toggle(midi, step); return }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (event.shiftKey) {
      const found = covering(midi, step)
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
      const members = membersFor(midi, step, draft.current)
      if (found) edit(draft.current.map((n) => members.includes(n) ? { ...n, length: Math.max(1, Math.min(total - n.step, n.length + delta)) } : n))
      return
    }
    const row = rows.indexOf(midi)
    const nextMidi = rows[Math.max(0, Math.min(rows.length - 1, row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)))]
    const nextStep = Math.max(0, Math.min(total - 1, step + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)))
    focusNext.current = true
    setPage(Math.floor(nextStep / 16)); setCursor({ midi: nextMidi, step: nextStep })
  }
  useLayoutEffect(() => {
    if (!focusNext.current) return
    focusNext.current = false
    root.current?.querySelector<HTMLButtonElement>(`[data-midi="${cursor.midi}"][data-step="${cursor.step}"]`)?.focus()
  }, [cursor, page])
  useEffect(() => {
    if (!rows.includes(cursor.midi) || Math.floor(cursor.step / 16) !== currentPage) {
      setCursor({ midi: rows.includes(cursor.midi) ? cursor.midi : rows[0], step: currentPage * 16 })
    }
  }, [currentPage, rows.join(','), cursor.midi, cursor.step])
  const lastHead = useRef(-1)
  useFrame(() => {
    const pos = engine.getPosition()
    const head = pos.playing && !pos.countIn ? pos.step : -1
    if (lastHead.current === head) return
    root.current?.querySelectorAll('[data-grid-now]').forEach((el) => el.removeAttribute('data-grid-now'))
    if (head >= 0) root.current?.querySelectorAll(`[data-step="${head}"]`).forEach((el) => el.setAttribute('data-grid-now', ''))
    lastHead.current = head
  })
  useEffect(() => { lastHead.current = -2 }, [currentPage, rows.join(',')])
  return <div className="note-grid" aria-label={`Grade de notas, faixa ${track + 1}`}>
    <p className="note-grid__help">Setas movem o cursor; Enter liga ou desliga; Shift + setas muda a duração. Arraste para estender.</p>
    {!chordsMode && <label className="pad-scale"><span className="field__label">Escala</span>
      <select aria-label="Escala da grade" value={state.scale} onChange={(e) => engine.setScale(e.target.value as PadScale)}>
        {PAD_SCALES.map((scale) => <option key={scale} value={scale}>{scale === 'major' ? 'Maior (todas as notas)' : 'Pentatônica (nunca erra)'}</option>)}
      </select>
    </label>}
    <div className="note-grid__tools">
      <button type="button" className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span>Compasso {currentPage + 1} de {state.bars}</span>
      <button type="button" className="btn" disabled={currentPage === state.bars - 1} onClick={() => setPage(currentPage + 1)}>Próximo</button>
      <label>Zoom <input aria-label="Zoom da grade" type="range" min="18" max="48" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
    </div>
    {loose > 0 && <div className="note-grid__warning"><p>Esta faixa tem {loose} notas soltas que não formam uma tríade completa.</p>
      <button type="button" className="btn btn--ghost" onClick={() => engine.setTrack(track, { padMode: 'notes' })}>Mostrar notas</button></div>}
    {!chordsMode && (outside > 0 || chromatic) && <div className="note-grid__warning">
      {outside > 0 && <><p>Esta faixa tem {outside} notas fora da escala.</p><button type="button" className="btn btn--ghost" disabled={disabled} onClick={() => edit(draft.current.map((n) => ({ ...n, midi: snapToScale(n.midi, state.key, state.scale) })))}>Encaixar na escala</button></>}
      <button type="button" className="btn btn--ghost" aria-pressed={chromatic} onClick={() => setChromatic(!chromatic)}>{chromatic ? 'Mostrar só a escala' : 'Mostrar todas as notas'}</button>
    </div>}
    <div className="note-grid__scroll" ref={root} tabIndex={0} aria-label="Notas: role para ver o compasso" style={{ '--cell': `${zoom}px` } as CSSProperties}>
      <div className="note-grid__row note-grid__ruler"><span>{chordsMode ? 'Acorde' : 'Nota'}</span>{Array.from({ length: 16 }, (_, i) => <span key={i} data-beat={i % 4 === 0 || undefined}>{i % 4 === 0 ? `${i / 4 + 1}` : '·'}</span>)}</div>
      {rows.map((midi) => <div className="note-grid__row" key={midi} data-outside={!chordsMode && !classes.includes(((midi % 12) + 12) % 12) || undefined}>
        <span className="note-grid__name">{rowName(midi)}</span>
        {Array.from({ length: 16 }, (_, i) => {
          const step = currentPage * 16 + i
          const on = !!covering(midi, step, notes)
          return <button key={step} type="button" data-midi={midi} data-step={step} data-beat={i % 4 === 0 || undefined} aria-pressed={on}
            aria-label={`${chordsMode ? 'Acorde' : 'Nota'} ${rowName(midi)}, passo ${step + 1}, ${on ? 'ligada' : 'desligada'}`}
            tabIndex={cursor.midi === midi && cursor.step === step ? 0 : -1} disabled={disabled}
            onFocus={() => setCursor({ midi, step })} onPointerDown={(e) => begin(e, midi, step)} onPointerMove={move}
            onPointerUp={finish} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)}
            onKeyDown={(e) => keyboard(e, midi, step)} onClick={(e) => { if (e.detail === 0) toggle(midi, step) }} />
        })}
      </div>)}
    </div>
    <p role="status">{saving ? 'Atualizando áudio…' : message}</p>
  </div>
}
