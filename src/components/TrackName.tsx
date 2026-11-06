import { useState } from 'react'
import { PencilIcon } from './Icons'

const NAME_LIST_ID = 'track-name-ideas'
const MAX = 24

/** Nome do canal editável no lugar: duplo clique ou lápis; Enter/blur salva, Esc cancela. */
export function TrackName({ id, name, fallback, onRename }: { id: string; name: string; fallback: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const shown = name || fallback

  if (editing)
    return (
      <input
        className="strip__rename"
        defaultValue={shown}
        list={NAME_LIST_ID}
        maxLength={MAX}
        aria-label={`Nome de ${shown}`}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
        onBlur={(e) => {
          if (!editing) return
          const v = e.currentTarget.value.trim().slice(0, MAX)
          if (v !== shown) onRename(v || fallback)
          setEditing(false)
        }}
      />
    )

  return (
    <>
      <h2 className="strip__name" id={id} onDoubleClick={() => setEditing(true)} title={shown}>{shown}</h2>
      <button className="strip__edit" onClick={() => setEditing(true)} aria-label={`Renomear ${shown}`} title="Renomear">
        <PencilIcon size={13} />
      </button>
    </>
  )
}

/** Sugestões rápidas para os nomes (um datalist para a página toda). */
export function NameIdeas() {
  return (
    <datalist id={NAME_LIST_ID}>
      {['Beatbox', 'Voz', 'Palmas', 'Baixo', 'Melodia', 'Efeito'].map((v) => <option key={v} value={v} />)}
    </datalist>
  )
}
