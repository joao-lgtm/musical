import { openNoteGrid } from './NoteGrid'
import { useEffect, useRef, useState } from 'react'
import { bandFromStyle, completeFromTake } from '../audio/transform'
import { STYLES, rememberStyle } from './stylePresets'
import type { LoopEngine } from '../audio/types'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { DiceIcon } from './Icons'
import { DRUM_PRESETS, toPattern } from './drumPresets'

export const BAND_EVENT = 'loopstudio:band-ready'
export function BatchActions({ track }: { track?: number }) {
  const engine = useEngine()
  const state = useEngineState(engine)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [applied, setApplied] = useState(false)
  const generation = useRef(0)
  const processing = useRef(false)
  useEffect(() => () => { generation.current++ }, [engine, track])
  async function generate() {
    if (processing.current) return
    const snapshot = engine.getState()
    const take = track === undefined ? null : engine.getTakeAudio(track)
    if (track !== undefined && !take) { setMessage('Esse take não está mais disponível.'); return }
    const operation = generation.current
    const current = () => generation.current === operation
    const empty = snapshot.tracks.map((t, i) => t.kind === 'mic' && t.status === 'empty' ? i : -1).filter((i) => i >= 0)
    const unchanged = () => {
      const next = engine.getState()
      return next.bpm === snapshot.bpm && next.bars === snapshot.bars && next.key === snapshot.key && next.kit === snapshot.kit && next.swing === snapshot.swing &&
        next.tracks.length === snapshot.tracks.length && snapshot.tracks.every((t, i) =>
          next.tracks[i].revision === t.revision && next.tracks[i].status === t.status && next.tracks[i].source === t.source)
    }
    processing.current = true
    setBusy(true)
    setMessage('')
    try {
      if (take) {
        const result = await completeFromTake(take.samples, take.sampleRate, snapshot.bpm, snapshot.bars, 'kalimba')
        if (!current()) return
        if (!unchanged()) { setMessage('O projeto mudou durante a geração. Tente de novo.'); return }
        if (!result) { setMessage('Não encontramos melodia para acompanhar.'); return }
        if (empty.length < 2) { setMessage('Preciso de 2 faixas livres para acordes e baixo.'); return }
        const [a, b] = empty
        const ok = engine.applyBatch({ takes: [
          { track: a, samples: result.chordsAudio, sampleRate: take.sampleRate, source: 'kalimba', notes: result.chordNotes },
          { track: b, samples: result.bassAudio, sampleRate: take.sampleRate, source: 'bass', notes: result.bassNotes },
        ] })
        if (!ok) { setMessage('Não deu para aplicar agora. Tente de novo.'); return }
        setApplied(true)
        openNoteGrid(engine, a); openNoteGrid(engine, b)
        setMessage(`Pronto: acordes ${result.chords.join(' ')} na faixa ${a + 1} e baixo na faixa ${b + 1}. Desfazer volta tudo.`)
      } else {
        const choice = STYLES[Math.floor(Math.random() * STYLES.length)]
        const seed = Math.floor(Math.random() * 1000000)
        const result = await bandFromStyle(snapshot.key, snapshot.bpm, snapshot.bars, choice.progressionStyle, seed)
        if (!current()) return
        if (!unchanged()) { setMessage('O projeto mudou durante a geração. Tente de novo.'); return }
        const takes: NonNullable<Parameters<LoopEngine['applyBatch']>[0]['takes']> = []
        if (empty.length >= 2) {
          takes.push({ track: empty[0], samples: result.chordsAudio, sampleRate: 48000, source: result.chordInstrument, notes: result.chordNotes })
          takes.push({ track: empty[1], samples: result.bassAudio, sampleRate: 48000, source: 'bass', notes: result.bassNotes })
        } else if (empty.length === 1) takes.push({ track: empty[0], samples: result.bassAudio, sampleRate: 48000, source: 'bass', notes: result.bassNotes })
        const preset = DRUM_PRESETS.find((p) => p.name === choice.drums)
        if (!preset) { setMessage('Este estilo ainda não está disponível. Tente de novo.'); return }
        if (!engine.applyBatch({ takes, pattern: toPattern(preset) })) { setMessage('Não deu para aplicar agora. Tente de novo.'); return }
        engine.setKit(choice.kit)
        engine.setSwing(choice.swing)
        rememberStyle(engine, choice)
        setApplied(true)
        for (const take of takes) openNoteGrid(engine, take.track)
        setMessage(empty.length >= 2 ? `Banda no estilo ${choice.name}: acordes, baixo e bateria.` : empty.length === 1
          ? 'Baixo e bateria prontos. Faltou espaço para os acordes.' : 'Bateria pronta. Sem faixas livres para acordes e baixo.')
        window.dispatchEvent(new CustomEvent(BAND_EVENT, { detail: { engine, active: true } }))
        if (!engine.getState().playing) engine.play()
      }
    } catch {
      if (current()) setMessage('Não deu para gerar o acompanhamento. Tente de novo.')
    } finally {
      if (current()) { processing.current = false; setBusy(false) }
    }
  }
  const eligible = track === undefined || state.tracks[track]?.status === 'recorded'
  return <div className={track === undefined ? 'batch-actions batch-actions--band' : 'batch-actions'}>
    {(eligible || busy) && <button type="button" className={track === undefined ? 'btn cue__band' : 'btn btn--ghost'}
      aria-label={track === undefined ? 'Gera bateria, baixo e harmonia nas faixas livres' : undefined} aria-busy={busy || undefined}
      aria-disabled={busy || state.status !== 'ready' || undefined} onClick={() => { if (!busy && state.status === 'ready') void generate() }}>
      {track === undefined && <DiceIcon size={18} />}
      {busy ? 'Gerando…' : track === undefined ? 'Surpreenda-me com a banda' : 'Completar (acordes + baixo)'}
    </button>}
    <p role="status">{message}</p>
    {applied && state.canUndoBatch && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => {
      engine.undoBatch()
      if (!engine.getState().canUndoBatch) {
        setApplied(false)
        setMessage('Acompanhamento desfeito.')
        window.dispatchEvent(new CustomEvent(BAND_EVENT, { detail: { engine, active: false } }))
      } else setMessage('Não deu para desfazer agora. Tente de novo.')
    }}>Desfazer</button>}
  </div>
}
