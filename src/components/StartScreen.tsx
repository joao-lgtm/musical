import { useEffect, useState } from 'react'
import { loadDraft } from '../storage/projects'
import type { ProjectData } from '../audio/types'
import type { CSSProperties } from 'react'
import type { EngineState } from '../audio/types'
import { useEngine } from '../hooks/useEngine'
import { PlayIcon } from './Icons'
import { STYLES, applyStyle } from './stylePresets'
import type { StylePreset } from './stylePresets'
import { DEMO_PRESET, toPattern } from './drumPresets'

export function StartScreen({ state }: { state: EngineState }) {
  const engine = useEngine()
  const [draft, setDraft] = useState<ProjectData | null>(null)
  useEffect(() => {
    let mounted = true
    async function readDraft() {
      try {
        const saved = await loadDraft()
        if (mounted) setDraft(saved)
      } catch {
        if (mounted) setDraft(null)
      }
    }
    void readDraft()
    return () => { mounted = false }
  }, [])
  const layers = draft?.tracks.filter((track) => track.audio !== null).length ?? 0
  const busy = state.status === 'initializing'
  const failed = state.status === 'error'

  async function start(resume = false, style?: StylePreset) {
    try {
      await engine.init()
      if (resume && draft) {
        engine.importProject(draft)
        engine.play()
        return
      }
      if (style) { applyStyle(engine, style); return }
      const current = engine.getState()
      // Só oferece a batida inicial em uma mesa vazia; projetos abertos são preservados.
      if (current.tracks.every((t) => t.status === 'empty') && !current.pattern.some((row) => row.some(Boolean))) {
        engine.setPattern(toPattern(DEMO_PRESET))
        engine.setTrack(current.tracks.length - 1, { volume: 0.6 })
      }
      engine.play()
    } catch { /* status error apresenta a falha de áudio */ }
  }

  return (
    <main className="start">
      <div className="start__panel">
        <div className="start__bars" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} style={{ '--ch': `var(--ch${i})`, '--d': `${i * 140}ms` } as CSSProperties} />
          ))}
        </div>
        <h1 className="start__title">Loop Studio</h1>
        <p className="start__lede">
          Monte uma música em camadas: a batida já está pronta, você grava o resto por cima.
        </p>
        {/* a rejeição já vira state.error; o catch só evita erro não tratado */}
        <div className="start__actions">
          <button className="btn btn--primary start__go" onClick={() => start(!!draft)} disabled={busy}>
            <PlayIcon size={20} />
            {busy ? 'Preparando o áudio…' : failed ? 'Tentar de novo' : draft ? 'Continuar de onde parou' : 'Começar a tocar'}
          </button>
          <div className="start__styles" role="group" aria-labelledby="style-label">
            <p id="style-label">Ou comece por um estilo:</p>
            <div>{STYLES.map((style) => <button type="button" className="btn btn--ghost" key={style.name}
              aria-pressed={false} disabled={busy} onClick={() => start(false, style)}>{style.name}</button>)}</div>
          </div>
          <p className="start__draft" aria-live="polite">
            {draft ? `${layers} ${layers === 1 ? 'camada' : 'camadas'}, ${draft.bpm} BPM` : ''}
          </p>
          <div className="start__fresh">
            {draft && <button className="btn btn--ghost" onClick={() => start()} disabled={busy}>Começar do zero</button>}
          </div>
        </div>
        <p className="start__hint">O microfone só é pedido quando você for gravar. O áudio nunca sai deste navegador.</p>
        {failed && (
          <div className="start__error" role="alert">Não conseguimos iniciar o áudio. Toque em Tentar de novo.</div>
        )}
      </div>
    </main>
  )
}
