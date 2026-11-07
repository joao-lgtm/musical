import { useEffect, useState } from 'react'
import { KEYS } from '../audio/types'
import type { Key } from '../audio/types'
import { keyName } from './NotePads'
import type { EngineState } from '../audio/types'
import { useEngine } from '../hooks/useEngine'
import { BeatIndicator } from './BeatIndicator'
import { LockIcon, MetronomeIcon, PlayIcon, StopIcon, TrashIcon } from './Icons'

const BARS = [1, 2, 4] as const

export function Transport({ state, studio }: { state: EngineState; studio: boolean }) {
  const engine = useEngine()
  const locked = state.tracks.some((t) => t.kind === 'mic' && t.status !== 'empty')
  const hasAudio = state.tracks.some((t) => t.status !== 'empty')
  const [confirming, setConfirming] = useState(false)

  // confirmação em dois cliques para "apagar tudo"; expira sozinha
  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(id)
  }, [confirming])

  function clearAll() {
    if (!confirming) return setConfirming(true)
    engine.clearAll()
    setConfirming(false)
  }

  return (
    <section className="transport" aria-label="Transporte">
      <button
        className="btn btn--play"
        onClick={() => (state.playing ? engine.stop() : engine.play())}
        aria-label={state.playing ? 'Parar' : 'Tocar'}
        aria-keyshortcuts="Space"
        data-on={state.playing || undefined}
      >
        {state.playing ? <StopIcon size={28} /> : <PlayIcon size={28} />}
        <kbd className="btn__key" aria-hidden="true">Espaço</kbd>
      </button>

      <div className="field field--bpm" data-locked={locked || undefined}>
        <label htmlFor="bpm" className="field__label">
          Andamento {locked && <LockIcon size={12} />}
        </label>
        <div className="bpm">
          <output htmlFor="bpm" className="bpm__num">{state.bpm}</output>
          <span className="bpm__unit">BPM</span>
        </div>
        <input
          id="bpm"
          type="range"
          min={60}
          max={180}
          value={state.bpm}
          disabled={locked}
          onChange={(e) => engine.setBpm(Number(e.target.value))}
          aria-describedby={locked ? 'lock-note' : undefined}
        />
      </div>

      <fieldset className="field field--bars" disabled={locked} aria-describedby={locked ? 'lock-note' : undefined}>
        <legend className="field__label">Compassos {locked && <LockIcon size={12} />}</legend>
        <div className="seg">
          {BARS.map((b) => (
            <button key={b} className="seg__btn" aria-pressed={state.bars === b} onClick={() => engine.setBars(b)}>
              {b}
            </button>
          ))}
        </div>
      </fieldset>

      <button
        className="btn btn--toggle"
        aria-pressed={state.metronome}
        onClick={() => engine.setMetronome(!state.metronome)}
      >
        <MetronomeIcon size={18} />
        Metrônomo
      </button>

      <button className="btn btn--ghost btn--danger" onClick={clearAll} disabled={!hasAudio} data-confirm={confirming || undefined}>
        <TrashIcon size={18} />
        {confirming ? 'Confirmar?' : 'Apagar tudo'}
      </button>

      {studio && <label className="field field--key"><span className="field__label">Tom</span>
        <select aria-label="Tom do projeto" value={state.key} onChange={(e) => engine.setKey(e.target.value as Key)}>
          {KEYS.map((key) => <option key={key} value={key}>{keyName(key)}</option>)}
        </select>
      </label>}
      <BeatIndicator bars={state.bars} />

      <p id="lock-note" className="transport__note" hidden={!locked}>
        <LockIcon size={12} /> Andamento e compassos travados enquanto houver canal de microfone armado, gravando ou gravado. Apague tudo para mudar.
      </p>
    </section>
  )
}
