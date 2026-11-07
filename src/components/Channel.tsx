import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { TrackState } from '../audio/types'
import { readFrame, useEngine, useEngineState, useFrame } from '../hooks/useEngine'
import { Fader } from './Fader'
import { MuteIcon, RecIcon, TrashIcon, UndoIcon } from './Icons'
import { Knob } from './Knob'
import { TrackName } from './TrackName'
import { VuMeter } from './VuMeter'
import { Waveform } from './Waveform'
import { NotePads, rememberOcarina } from './NotePads'
import { FX_KNOBS } from './fx'

type Props = {
  index: number
  track: TrackState
  transportPlaying: boolean
  studio: boolean
  /** REC pulsando: é a próxima ação sugerida pela faixa-guia */
  hint: boolean
  dimmed: boolean
  /** vazio e além do próximo livre: no celular mostra só cabeçalho + Gravar */
  collapsible?: boolean
}

const STATUS = { empty: 'Vazia', armed: 'Armada', recording: 'Gravando', recorded: 'Em loop' } as const

export function Channel({ index, track, transportPlaying, studio, hint, dimmed, collapsible }: Props) {
  const engine = useEngine()
  const { mic, micTrack } = useEngineState(engine)
  const requesting = track.source === 'mic' && mic === 'requesting' && micTrack === index
  const unavailable = track.source === 'mic' && (mic === 'denied' || mic === 'missing')
  const micFailed = unavailable && micTrack === index
  const blocked = unavailable && micTrack !== null && micTrack !== index
  const n = index + 1
  const { status, muted, solo, overdubbing } = track
  const rec = status === 'armed' || status === 'recording'
  const stripRef = useRef<HTMLElement>(null)
  const armBar = useRef<HTMLDivElement>(null)
  const armText = useRef<HTMLSpanElement>(null)
  const prev = useRef(status)

  // flash "Loop!" quando o take fecha (recording → recorded)
  useEffect(() => {
    const el = stripRef.current
    if (el && prev.current === 'recording' && status === 'recorded') {
      el.setAttribute('data-flash', '')
      const id = setTimeout(() => el.removeAttribute('data-flash'), 450)
      prev.current = status
      return () => clearTimeout(id)
    }
    prev.current = status
  }, [status])

  // armado: barra "começa em…" encolhendo até o início do próximo loop
  const lastText = useRef('')
  useFrame(() => {
    if (status !== 'armed' || !armBar.current || !armText.current) return
    const p = readFrame(engine).pos
    // o motor sabe quando a gravação começa de fato (pode pular uma virada por margem)
    const secs = Math.max(0, engine.getArmedIn(index) ?? 0)
    const loop = engine.getState().loopDuration || 1
    armBar.current.style.transform = `scaleX(${Math.min(1, secs / loop)})`
    const txt = `${p.countIn ? 'Contagem · ' : 'Começa em '}${secs.toFixed(1).replace('.', ',')} s`
    if (txt !== lastText.current) armText.current.textContent = lastText.current = txt
  })

  const recLabel = requesting ? 'Pedindo microfone…' : micFailed ? 'Tentar de novo' : rec ? 'Cancelar' : status === 'recorded' ? (overdubbing ? 'Overdub' : 'Regravar') : 'Gravar'
  const statusText = status === 'recorded' && !transportPlaying ? 'Pronta' : STATUS[status]

  return (
    <section
      ref={stripRef}
      className="strip"
      data-status={status}
      data-muted={muted || undefined}
      data-dim={dimmed || undefined}
      data-collapsible={(collapsible && !micFailed && track.source !== 'ocarina') || undefined}
      style={{ '--ch': `var(--ch${n})`, '--ch-lit': `var(--ch${n}-lit)` } as CSSProperties}
      aria-labelledby={`ch${n}-name`}
    >
      <header className="strip__head">
        <span className="strip__num" aria-hidden="true">{n}</span>
        <TrackName id={`ch${n}-name`} name={track.name} fallback={`Faixa ${n}`} onRename={(name) => engine.setTrack(index, { name })} />
        <span className="strip__status" role="status">{statusText}</span>
      </header>

      <div className="seg seg--source" role="group" aria-label={`Fonte de som, faixa ${n}`}>
        <button className="seg__btn" aria-pressed={track.source === 'mic'} onClick={() => engine.setTrack(index, { source: 'mic' })}>Microfone</button>
        <button className="seg__btn" aria-pressed={track.source === 'ocarina'} onClick={() => { rememberOcarina(engine, index); engine.setTrack(index, { source: 'ocarina' }) }}>Ocarina</button>
      </div>
      {track.source === 'ocarina' && <NotePads track={index} />}
      <div className="screen">
        <Waveform track={index} status={status} muted={muted} revision={track.revision} />
        {status === 'empty' && <span className="screen__hint">Vazia</span>}
        {status === 'recording' && <span className="screen__rec"><i /> Gravando</span>}
        {status === 'armed' && (
          <div className="screen__arm">
            <span ref={armText}>Começa em…</span>
            <div className="screen__armbar"><div ref={armBar} /></div>
          </div>
        )}
        <span className="screen__loop" aria-hidden="true">Loop!</span>
      </div>

      <button
        className="rec"
        data-requesting={requesting || undefined}
        aria-busy={requesting || undefined}
        disabled={blocked}
        title={blocked ? 'Microfone indisponível' : undefined}
        aria-describedby={blocked ? `ch${n}-mic-unavailable` : micFailed ? `ch${n}-mic-error` : undefined}
        data-hint={hint || undefined}
        aria-pressed={rec}
        onClick={() => engine.record(index)}
        aria-label={`${rec ? 'Cancelar gravação' : recLabel}, faixa ${n}${status === 'recorded' && !overdubbing ? ' (apaga o take atual)' : ''}`}
        aria-keyshortcuts={String(n)}
      >
        <span className="rec__dot">{requesting ? <span className="mic-spinner" aria-hidden="true" /> : <RecIcon size={18} />}</span>
        <span className="rec__text">{recLabel}</span>
        <kbd className="rec__key">{n}</kbd>
      </button>

      {blocked && <span id={`ch${n}-mic-unavailable`} className="sr-only">Microfone indisponível</span>}
      {micFailed && (
        <p id={`ch${n}-mic-error`} className="strip__mic-error" role="alert">
          {mic === 'denied'
            ? 'Microfone bloqueado. Libere no cadeado ao lado do endereço e toque em Tentar de novo.'
            : 'Nenhum microfone disponível. Conecte um ou feche outros apps que o usam.'}
        </p>
      )}
      {studio && (
        <div className="seg seg--mode" role="group" aria-label={`Modo de gravação, faixa ${n}`}>
          <button className="seg__btn" aria-pressed={!overdubbing} onClick={() => engine.setTrack(index, { overdubbing: false })} title="Gravar apaga o take anterior" aria-label="Substituir">
            Subst.
          </button>
          <button className="seg__btn" aria-pressed={overdubbing} onClick={() => engine.setTrack(index, { overdubbing: true })} title="Gravar soma uma camada ao take">
            Overdub
          </button>
        </div>
      )}

      {studio && (
        <div className="strip__knobs">
          {FX_KNOBS.map(({ param, ...k }) => (
            <Knob
              key={param}
              {...k}
              name={`${k.label}, faixa ${n}`}
              value={track[param]}
              onChange={(v) => engine.setTrack(index, { [param]: v })}
            />
          ))}
        </div>
      )}

      <div className="strip__mix">
        <Fader name={`Volume, faixa ${n}`} value={track.volume} onChange={(v) => engine.setTrack(index, { volume: v })} />
        <VuMeter index={index} />
      </div>

      <div className="strip__btns">
        <button className="tbtn tbtn--mute" aria-pressed={muted} onClick={() => engine.setTrack(index, { muted: !muted })} aria-label={`Mudo, faixa ${n}`} title="Mudo">
          <MuteIcon size={15} /><span>M</span>
        </button>
        {studio && (
          <>
            <button className="tbtn tbtn--solo" aria-pressed={solo} onClick={() => engine.setTrack(index, { solo: !solo })} aria-label={`Solo, faixa ${n}`} title="Solo">
              <span>S</span>
            </button>
            <button className="tbtn" onClick={() => engine.clear(index)} disabled={status === 'empty'} aria-label={`Apagar, faixa ${n}`} title="Apagar take">
              <TrashIcon size={15} />
            </button>
            <button className="tbtn" onClick={() => engine.undo(index)} disabled={!track.canUndo} aria-label={`Desfazer, faixa ${n}`} title="Desfazer">
              <UndoIcon size={15} />
            </button>
          </>
        )}
      </div>

      {studio && (
        <details className="strip__more">
          <summary>Ajuste fino</summary>
          <label className="nudge">
            <span>Nudge</span>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={track.nudge}
              onChange={(e) => engine.setTrack(index, { nudge: Number(e.target.value) })}
              aria-label={`Nudge, faixa ${n}`}
              aria-valuetext={`${track.nudge} ms`}
            />
            <output>{track.nudge > 0 ? '+' : ''}{track.nudge} ms</output>
          </label>
        </details>
      )}
    </section>
  )
}
