import { useRef } from 'react'
import type { CSSProperties } from 'react'
import type { EngineState, TrackState } from '../audio/types'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'
import { Channel } from './Channel'
import { Fader } from './Fader'
import { FX_KNOBS } from './fx'
import { MuteIcon, TrashIcon } from './Icons'
import { Knob } from './Knob'
import { VuMeter } from './VuMeter'

type Props = { state: EngineState; studio: boolean }

/** Próxima faixa sugerida (REC pulsando) ou null quando a guia já não precisa insistir. */
function guideHint(state: EngineState): number | null {
  const mics = state.tracks.slice(0, -1)
  if (mics.some((t) => t.status === 'armed' || t.status === 'recording')) return null
  const layers = mics.filter((t) => t.status === 'recorded').length
  const free = mics.findIndex((t) => t.status === 'empty')
  return layers < 2 && free >= 0 ? free : null
}

export function Mixer({ state, studio }: Props) {
  const hint = guideHint(state)
  const drumsIndex = state.tracks.length - 1
  const mics = state.tracks.slice(0, drumsIndex)
  const firstFree = mics.findIndex((t) => t.status === 'empty')
  const anySolo = state.tracks.some((t) => t.solo)
  // modo simples: só canais com algo + o próximo livre
  const visible = mics
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => studio || t.status !== 'empty' || i === firstFree)

  return (
    <section className="mixer" data-studio={studio || undefined} aria-label="Mixer">
      <div className="mixer__rail">
        {visible.map(({ t, i }) => (
          <Channel
            key={i}
            index={i}
            track={t}
            transportPlaying={state.playing}
            studio={studio}
            hint={hint === i}
            collapsible={t.status === 'empty' && i !== firstFree}
            dimmed={anySolo && !t.solo}
          />
        ))}
        <DrumStrip index={drumsIndex} track={state.tracks[drumsIndex]} pattern={state.pattern} studio={studio} dimmed={anySolo && !state.tracks[drumsIndex].solo} />
        <MasterStrip state={state} />
      </div>
    </section>
  )
}

function DrumStrip({ index, track, pattern, studio, dimmed }: { index: number; track: TrackState; pattern: EngineState['pattern']; studio: boolean; dimmed: boolean }) {
  const engine = useEngine()
  const head = useRef<HTMLDivElement>(null)
  const steps = pattern[0]?.length ?? 16

  useFrame(() => {
    const p = readFrame(engine).pos
    if (!head.current) return
    head.current.style.opacity = p.playing && !p.countIn ? '1' : '0'
    head.current.style.transform = `translateX(${p.step * 100}%)`
  })

  return (
    <section
      className="strip strip--drums"
      data-status={track.status}
      data-muted={track.muted || undefined}
      data-dim={dimmed || undefined}
      style={{ '--ch': 'var(--ch9)', '--ch-lit': 'var(--ch9-lit)', '--steps': steps } as CSSProperties}
      aria-labelledby="ch-drums-name"
    >
      <header className="strip__head">
        <span className="strip__num" aria-hidden="true">B</span>
        <h2 className="strip__name" id="ch-drums-name">Bateria</h2>
        <span className="strip__status" role="status">{track.status === 'recorded' ? 'Padrão' : 'Vazia'}</span>
      </header>

      <div className="screen screen--pattern" aria-hidden="true">
        <div className="mini">
          {pattern.map((row, v) => (
            <div className="mini__row" key={v}>
              {row.map((on, s) => <i key={s} data-on={on || undefined} data-beat={s % 4 === 0 || undefined} />)}
            </div>
          ))}
          <div className="mini__head" ref={head} />
        </div>
      </div>

      {studio && (
        <div className="strip__knobs">
          {FX_KNOBS.map(({ param, ...k }) => (
            <Knob key={param} {...k} name={`${k.label}, bateria`} value={track[param]} onChange={(v) => engine.setTrack(index, { [param]: v })} />
          ))}
        </div>
      )}

      <div className="strip__mix">
        <Fader name="Volume, bateria" value={track.volume} onChange={(v) => engine.setTrack(index, { volume: v })} />
        <VuMeter index={index} />
      </div>

      <div className="strip__btns">
        <button className="tbtn tbtn--mute" aria-pressed={track.muted} onClick={() => engine.setTrack(index, { muted: !track.muted })} aria-label="Mudo, bateria" title="Mudo">
          <MuteIcon size={15} /><span>M</span>
        </button>
        {studio && (
          <>
            <button className="tbtn tbtn--solo" aria-pressed={track.solo} onClick={() => engine.setTrack(index, { solo: !track.solo })} aria-label="Solo, bateria" title="Solo">
              <span>S</span>
            </button>
            <button className="tbtn" onClick={() => engine.clear(index)} disabled={track.status === 'empty'} aria-label="Limpar padrão da bateria" title="Limpar padrão">
              <TrashIcon size={15} />
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function MasterStrip({ state }: { state: EngineState }) {
  const engine = useEngine()
  return (
    <section className="strip strip--master" aria-labelledby="ch-master-name">
      <header className="strip__head">
        <h2 className="strip__name" id="ch-master-name">Master</h2>
      </header>
      <div className="master__meter">
        <VuMeter index={state.tracks.length} className="vu--master" />
        <div className="master__scale" aria-hidden="true">
          {[0, -6, -12, -24, -36, -48].map((d) => (
            <span key={d} style={{ bottom: `${((48 + d) / 48) * 100}%` }}>{d === 0 ? '0' : `−${-d}`}</span>
          ))}
        </div>
      </div>
      <div className="strip__mix strip__mix--master">
        <Fader name="Volume master" value={state.masterVolume} onChange={(v) => engine.setMasterVolume(v)} />
      </div>
    </section>
  )
}
