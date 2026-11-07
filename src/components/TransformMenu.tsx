import { useEffect, useRef, useState } from 'react'
import { voiceToInstrument } from '../audio/transform'
import { detectDrums } from '../audio/beatbox'
import { useEngine, useEngineState } from '../hooks/useEngine'

export function TransformMenu({ track }: { track: number }) {
  const engine = useEngine()
  const state = useEngineState(engine)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const processing = useRef(false)
  const free = state.tracks.findIndex((t) => t.kind === 'mic' && t.status === 'empty')
  useEffect(() => {
    return () => { generation.current++ }
  }, [])
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  async function transform(kind: 'new' | 'replace' | 'drums') {
    if (processing.current) return
    const take = engine.getTakeAudio(track)
    if (!take) { setMessage('Esse take não está mais disponível.'); setOpen(false); trigger.current?.focus(); return }
    const snapshot = engine.getState()
    const target = kind === 'drums' ? snapshot.tracks.length - 1 : kind === 'new'
      ? snapshot.tracks.findIndex((t) => t.kind === 'mic' && t.status === 'empty') : track
    if (kind === 'new' && target < 0) return
    const operation = generation.current
    const sourceRevision = snapshot.tracks[track].revision
    const targetRevision = snapshot.tracks[target].revision
    const expectedStatus = kind === 'new' ? 'empty' : kind === 'replace' ? 'recorded' : snapshot.tracks[target].status
    const isCurrent = () => generation.current === operation
    const canApply = () => {
      if (!isCurrent()) return false
      const current = engine.getState()
      if (current.tracks[track]?.revision !== sourceRevision || current.tracks[target]?.revision !== targetRevision ||
          current.tracks[target]?.status !== expectedStatus) {
        setMessage('O projeto mudou durante a transformação. Tente de novo.')
        return false
      }
      return true
    }
    processing.current = true
    setOpen(false)
    trigger.current?.focus()
    setBusy(true)
    setMessage('')
    try {
      if (kind === 'drums') {
        const pattern = await detectDrums(take.samples, take.sampleRate, snapshot.bpm, snapshot.bars)
        if (!canApply()) return
        if (!pattern.some((row) => row.some(Boolean))) {
          if (isCurrent()) setMessage('Não encontramos batidas nesse take.')
        } else {
          engine.setPattern(pattern)
          const applied = engine.getState().tracks[target]
          if (isCurrent()) setMessage(applied?.revision > targetRevision
            ? 'Padrão de bateria criado. Use desfazer no sequenciador para voltar.'
            : 'Não deu para aplicar agora. Tente de novo.')
        }
      } else {
        const result = await voiceToInstrument(take.samples, take.sampleRate, snapshot.bpm, snapshot.bars, snapshot.key)
        if (!canApply()) return
        if (!result.audio) {
          if (isCurrent()) setMessage('Não encontramos melodia nesse take. Tente cantar mais alto e uma nota por vez.')
        } else {
          engine.applyTake(target, result.audio, { sampleRate: take.sampleRate, source: 'ocarina' })
          const applied = engine.getState().tracks[target]
          if (isCurrent()) setMessage(applied?.revision > targetRevision && applied.source === 'ocarina'
            ? `Pronto: faixa ${target + 1} agora é ocarina. Use desfazer para voltar.`
            : 'Não deu para aplicar agora. Tente de novo.')
        }
      }
    } catch {
      if (isCurrent()) setMessage('Não deu para transformar o take. Tente de novo.')
    } finally {
      if (isCurrent()) {
        processing.current = false
        setBusy(false)
      }
    }
  }
  const eligible = state.tracks[track]?.source === 'mic' && state.tracks[track]?.status === 'recorded'
  return <div ref={root} className="transform">
    {(eligible || busy) && <button ref={trigger} type="button" className="btn btn--ghost transform__trigger"
      aria-expanded={open} aria-controls={`transform-${track}`} aria-busy={busy || undefined}
      aria-disabled={busy || undefined} onClick={() => { if (!busy) setOpen(!open) }}>
      {busy ? 'Transformando…' : 'Transformar'}
    </button>}
    {open && <div ref={panel} id={`transform-${track}`} className="transform__panel" role="group" aria-label={`Transformar faixa ${track + 1}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus() } }}>
      <button type="button" disabled={free < 0} title={free < 0 ? 'Sem faixa livre' : undefined} onClick={() => { void transform('new') }}>Em ocarina (próxima faixa livre)</button>
      <button type="button" onClick={() => { void transform('replace') }}>Em ocarina (substituir esta)</button>
      <button type="button" onClick={() => { void transform('drums') }}>Em bateria (sequenciador)</button>
    </div>}
    <p className="transform__status" role="status">{message}</p>
  </div>
}
