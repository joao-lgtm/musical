import type { Ref } from 'react'

const KEYS: [string[], string][] = [
  [['Espaço'], 'Tocar / parar'],
  [['1', '…', '8'], 'Gravar (ou cancelar) a faixa'],
  [['Q', 'W', 'E', 'R'], 'Peças 1–4 do kit da bateria'],
  [['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç'], 'Notas do instrumento: segure para tocar; L e Ç só na escala maior'],
  [['Z', 'X', 'C', 'V'], 'Peças 5–8 do kit da bateria'],
  [['T'], 'Ligar / desligar a gravação dos pads'],
  [['P'], 'Entrar / sair do modo Performance'],
  [['Esc'], 'Sair do modo Performance ou fechar a janela'],
  [['?'], 'Mostrar esta lista'],
]

// Lista de atalhos num <dialog> nativo (Esc fecha, foco preso pelo navegador)
export function Shortcuts({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog className="keys" ref={ref} aria-labelledby="keys-title">
      <h2 id="keys-title">Atalhos de teclado</h2>
      <dl>
        {KEYS.map(([keys, what]) => (
          <div key={what}>
            <dt>{keys.map((k) => (k === '…' ? <span key={k}>–</span> : <kbd key={k}>{k}</kbd>))}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="keys__note">Os atalhos não funcionam enquanto um campo ou controle estiver focado.</p>
      <form method="dialog">
        <button className="btn">Fechar</button>
      </form>
    </dialog>
  )
}
