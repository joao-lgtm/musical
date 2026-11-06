import type { CSSProperties } from 'react'
import type { TrackState } from '../audio/types'
import { engine } from '../hooks/useEngine'
import { MuteIcon, RecIcon, TrashIcon } from './Icons'
import { Waveform } from './Waveform'

const STATUS_TEXT = {
  empty: 'Vazia',
  armed: 'Armada',
  recording: 'Gravando',
  recorded: 'Em loop',
} as const

export function Channel({ index, track, transportPlaying }: { index: number; track: TrackState; transportPlaying: boolean }) {
  const n = index + 1
  const { status, volume, muted } = track
  const rec = status === 'armed' || status === 'recording'
  const statusText = status === 'recorded' && !transportPlaying ? 'Pronta' : STATUS_TEXT[status]

  return (
    <section
      className="ch"
      data-status={status}
      data-muted={muted || undefined}
      style={{ '--ch': `var(--ch${n})`, '--ch-lit': `var(--ch${n}-lit)` } as CSSProperties}
      aria-labelledby={`ch${n}-name`}
    >
      <header className="ch__head">
        <h2 className="ch__name" id={`ch${n}-name`}>
          <span className="ch__num">{n}</span> Faixa {n}
        </h2>
        <span className="ch__status" role="status">{statusText}</span>
      </header>

      <div className="wave">
        <Waveform track={index} status={status} muted={muted} />
        {status === 'empty' && <span className="wave__hint">Aperte gravar<span className="kbd-only"> ou a tecla {n}</span></span>}
      </div>

      <button
        className="rec"
        aria-pressed={rec}
        onClick={() => engine.record(index)}
        aria-label={`${rec ? "Cancelar gravação" : status === "recorded" ? "Regravar (apaga o take atual)" : "Gravar"}, faixa ${n}`}
        aria-keyshortcuts={String(n)}
      >
        <span className="rec__dot"><RecIcon size={22} /></span>
        <span className="rec__text">
          {rec ? "Cancelar" : status === "recorded" ? "Regravar" : "Gravar"}
          {status === "recorded" && <small className="rec__sub">apaga o take atual</small>}
        </span>
        <kbd className="rec__key">{n}</kbd>
      </button>

      <div className="ch__mix">
        <label className="fader">
          <span className="fader__label">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => engine.setVolume(index, Number(e.target.value))}
            aria-label={`Volume da faixa ${n}`}
            aria-valuetext={`${Math.round(volume * 100)}%`}
          />
          <span className="fader__val">{Math.round(volume * 100)}</span>
        </label>
        <div className="ch__btns">
          <button className="btn btn--sm btn--toggle btn--mute" aria-pressed={muted} onClick={() => engine.setMute(index, !muted)} aria-label={`Mudo, faixa ${n}`}>
            <MuteIcon size={16} /> <span>Mudo</span>
          </button>
          <button className="btn btn--sm btn--ghost" onClick={() => engine.clear(index)} disabled={status === 'empty'} aria-label={`Apagar faixa ${n}`}>
            <TrashIcon size={16} /> <span>Apagar</span>
          </button>
        </div>
      </div>
    </section>
  )
}
