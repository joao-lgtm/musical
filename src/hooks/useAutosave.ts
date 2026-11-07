import { useEffect, useRef } from 'react'
import type { LoopEngine } from '../audio/types'
import { createDraftProgress, draftWriteAction, hasDraftContentChanged, observeDraft } from '../storage/draft'
import type { DraftProgress } from '../storage/draft'
import { clearDraft, saveDraft } from '../storage/projects'

let warned = false

export function useAutosave(engine: LoopEngine, enabled: boolean): void {
  const session = useRef<{ engine: LoopEngine; progress: DraftProgress } | null>(null)
  const writes = useRef(Promise.resolve())

  useEffect(() => {
    if (session.current?.engine !== engine) {
      if (!enabled) return
      session.current = { engine, progress: createDraftProgress(engine.getState()) }
    }
    const current = session.current
    if (!current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const flush = () => {
      cancel()
      current.progress = observeDraft(current.progress, engine.getState())
      const action = draftWriteAction(current.progress)
      if (action === 'none' || action === 'defer') return
      try {
        if (action === 'save') {
          const data = engine.exportProject()
          writes.current = writes.current.then(() => saveDraft(data)).catch(warn)
        } else if (action === 'clear') {
          // Apagar usa a mesma fila para vencer qualquer save anterior ainda pendente.
          writes.current = writes.current.then(() => clearDraft()).catch(warn)
        }
        current.progress = { ...current.progress, dirty: false }
      } catch (error) {
        warn(error)
      }
    }

    // O progresso sobrevive a enabled=false; captura parcial permanece pendente.
    flush()
    if (!enabled) return

    const unsubscribe = engine.subscribe(state => {
      const changed = hasDraftContentChanged(current.progress.previous, state)
      current.progress = observeDraft(current.progress, state)
      const action = draftWriteAction(current.progress)
      if (action === 'defer') {
        cancel()
        return
      }
      if (current.progress.dirty && (changed || timer === undefined)) {
        cancel()
        timer = setTimeout(flush, 3000)
      }
    })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      cancel()
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [engine, enabled])
}

function warn(error: unknown) {
  if (warned) return
  warned = true
  console.warn('Falha ao salvar rascunho', error)
}
