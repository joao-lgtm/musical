# Loop Studio

Uma loop station no navegador: grave camadas pelo microfone, sobreponha bateria sintetizada e monte uma música em loop sem instalar nada. Tudo roda em Web Audio, sem samples e sem servidor; o áudio nunca sai da sua máquina.

**Demo:** https://joao-lgtm.github.io/musical/

## Funcionalidades

- 8 faixas de microfone, gravadas sincronizadas com o início do loop, com overdub e desfazer
- Bateria sintetizada (bumbo, caixa, chimbal, palmas) com sequenciador de 16 passos por compasso, pads ao vivo e "Surpreenda-me" com 5 estilos
- Mixer por canal: volume, mudo, solo, pan, filtro, delay sincronizado e reverb, com medidores VU
- BPM de 60 a 180, loops de 1, 2 ou 4 compassos, metrônomo e contagem 4-3-2-1
- Modo Simples e modo Estúdio
- Modo Performance em tela cheia, nomes editáveis das faixas e calibração de latência com palmas
- Gravação dos pads ao vivo, quantizada ao passo mais próximo (ative REC pads e dê play)
- Salvar e abrir projetos no navegador (IndexedDB), exportar WAV e gravar vídeo da tela com o áudio

## Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| `Espaço` | Tocar / parar |
| `1` – `8` | Gravar (ou cancelar) a faixa |
| `Q` `W` `E` `R` | Pads: bumbo, caixa, chimbal, palmas |
| `T` | Ligar / desligar REC pads |
| `P` / `Esc` | Entrar / sair do modo Performance |
| `?` | Mostrar os atalhos |

## Como rodar

```bash
npm i
npm run dev   # abre em http://localhost:5173
npm test
```

Precisa de um navegador com AudioWorklet (Chrome, Edge, Firefox ou Safari recentes) e permissão de microfone. Use fones para o som das caixas não vazar na gravação.

## Stack

React 19, TypeScript, Vite, Web Audio API (AudioWorklet, OfflineAudioContext), IndexedDB e Vitest. Nenhuma biblioteca de áudio.

## Como funciona a sincronia

O microfone passa por um AudioWorklet que envia cada bloco junto com o `currentFrame`, então cada amostra gravada tem a posição exata no relógio do áudio, sem depender de timers do JavaScript. A gravação é deslocada pela latência de entrada e saída (`baseLatency` + `outputLatency` + latência do microfone, mais um ajuste manual) para que a camada nova caia no tempo do que você estava ouvindo. Cada take toca como `AudioBufferSourceNode` em loop, iniciado com `start(when, offset)` alinhado ao início do loop, o que mantém todas as faixas em fase. Metrônomo e bateria são agendados por um scheduler com lookahead: um timer curto agenda no relógio do áudio os eventos dos próximos 100 ms.
