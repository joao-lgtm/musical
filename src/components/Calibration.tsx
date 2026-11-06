import { useState } from 'react'
import type { Ref } from 'react'
import type { CalibrationResult } from '../audio/types'
import { useEngine } from '../hooks/useEngine'

const CLICKS = 8
type Phase = 'intro' | 'running' | 'ok' | 'fail'

/** Assistente "bata palma no clique" num <dialog> nativo. onBusy trava atalhos enquanto mede. */
export function Calibration({ ref, onBusy }: { ref: Ref<HTMLDialogElement>; onBusy: (busy: boolean) => void }) {
  const engine = useEngine()
  const [phase, setPhase] = useState<Phase>('intro')
  const [lit, setLit] = useState(0)
  const [result, setResult] = useState<CalibrationResult | null>(null)

  async function run() {
    setPhase('running')
    setLit(0)
    onBusy(true)
    try {
      const r = await engine.calibrateLatency({ clicks: CLICKS, onClick: (i) => setLit(i + 1) })
      setResult(r)
      setPhase(r ? 'ok' : 'fail')
    } catch {
      setPhase('fail')
    } finally {
      onBusy(false)
    }
  }

  return (
    <dialog
      className="keys cal"
      ref={ref}
      aria-labelledby="cal-title"
      // não fecha no meio da medição
      onCancel={(e) => phase === 'running' && e.preventDefault()}
      onClose={() => phase !== 'running' && setPhase('intro')}
    >
      <h2 id="cal-title">Calibrar latência</h2>
      <p className="cal__lede">
        {phase === 'ok' && result
          ? `Pronto! Ajuste de ${result.offsetMs > 0 ? '+' : ''}${Math.round(result.offsetMs)} ms aplicado.`
          : phase === 'fail'
            ? 'Não ouvi palmas suficientes. Tente mais perto do microfone, com palmas secas.'
            : 'Bata uma palma junto com cada clique. São 8 cliques, uns 5 segundos.'}
      </p>

      <div className="cal__dots" data-phase={phase} aria-hidden="true">
        {Array.from({ length: CLICKS }, (_, i) => <i key={i} data-on={i < lit || undefined} />)}
      </div>
      <p className="sr-only" aria-live="polite">{phase === 'running' ? `Clique ${lit} de ${CLICKS}` : ''}</p>
      {phase === 'ok' && result && (
        <p className="keys__note">Reconheci {result.matched} de {result.total} palmas (variação de {Math.round(result.jitterMs)} ms). Vale para as próximas gravações.</p>
      )}

      <form method="dialog" className="cal__actions">
        <button className="btn btn--ghost" disabled={phase === 'running'}>{phase === 'ok' ? 'Fechar' : 'Cancelar'}</button>
        {phase !== 'ok' && (
          <button type="button" className="btn btn--primary" onClick={run} disabled={phase === 'running'}>
            {phase === 'running' ? 'Ouvindo…' : phase === 'fail' ? 'Tentar de novo' : 'Começar'}
          </button>
        )}
      </form>
    </dialog>
  )
}
