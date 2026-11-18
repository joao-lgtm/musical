# Loop Studio

Uma loop station no navegador: comece com uma batida pronta, grave camadas pelo microfone ou toque instrumentos sintetizados, e monte uma música em loop sem instalar nada. Tudo roda em Web Audio, sem samples e sem servidor; o áudio nunca sai da sua máquina.

**Demo:** https://joao-lgtm.github.io/musical/

## Funcionalidades

**Começar rápido**
- Um clique e a batida já toca; o microfone só é pedido quando você for gravar
- Estilos prontos (Pop, Lo-fi, Reggaeton, Funk) que ajustam BPM, tom, bateria e instrumento; estilos brasileiros (Pagode, Samba, Funk carioca) em **beta**
- "Surpreenda-me com a banda": gera bateria, baixo e harmonia nas faixas livres, com um desfazer
- Coach "Me ajuda a fazer um ritmo": 6 passos (bumbo, caixa, chimbal, baixo, harmonia, melodia)

**Gravar e tocar**
- 8 faixas, cada uma com microfone ou instrumento sintetizado: ocarina, flauta, kalimba, baixo e cavaquinho
- Pads de notas (escala pentatônica ou maior) e pads de acordes (Casa, Sobe, Tensão, Triste)
- Grade de notas para montar a melodia clicando, sem precisar tocar no tempo
- "Transformar" a voz em instrumento ou o beatbox em bateria, e "Completar" uma melodia com acordes e baixo
- Take silencioso detectado, gravar isolado (ouvir só a faixa), remover faixa com desfazer

**Bateria e mixagem**
- Bateria com 8 posições e kits Acústico, 808, Lo-fi e Roda; sequenciador de 16 passos por compasso, pads ao vivo e REC pads quantizado
- Bateria viva (viradas e humanização) e suingue ajustável no modo Estúdio
- Mixer por canal: volume, mudo, solo, pan, filtro, delay sincronizado e reverb, com medidores VU
- BPM de 60 a 180, loops de 1, 2 ou 4 compassos, metrônomo, contagem 4-3-2-1 e calibração de latência com palmas

**Guardar e compartilhar**
- Rascunho salvo sozinho ("Continuar de onde parou"), projetos no navegador (IndexedDB)
- Baixar ou compartilhar o loop em WAV, gravar vídeo da tela com o áudio, modo Performance em tela cheia

## Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| `Espaço` | Tocar / parar |
| `1` – `8` | Gravar (ou cancelar) a faixa |
| `Q` `W` `E` `R` / `Z` `X` `C` `V` | Pads de bateria (posições 1–4 / 5–8 do kit) |
| `A` `S` `D` `F` `G` `H` `J` `K` `L` `Ç` | Pads de notas do instrumento (`A`–`F` nos acordes) |
| `T` | Ligar / desligar REC pads |
| `P` / `Esc` | Entrar / sair do modo Performance |
| `?` | Mostrar os atalhos |

## Como rodar

```bash
npm i
npm run dev   # abre em http://localhost:5173
npm test
npm run build && npx vite preview   # build de produção em http://localhost:4173/musical/
```

Precisa de um navegador com AudioWorklet (Chrome, Edge, Firefox ou Safari recentes) e permissão de microfone. Use fones para o som das caixas não vazar na gravação.

## Stack

React 19, TypeScript, Vite, Web Audio API (AudioWorklet, OfflineAudioContext), IndexedDB e Vitest. Nenhuma biblioteca de áudio.

## Como funciona a sincronia

O microfone passa por um AudioWorklet que envia cada bloco junto com o `currentFrame`, então cada amostra gravada tem a posição exata no relógio do áudio, sem depender de timers do JavaScript. A gravação é deslocada pela latência de entrada e saída (`baseLatency` + `outputLatency` + latência do microfone, mais um ajuste manual) para que a camada nova caia no tempo do que você estava ouvindo. Cada take toca como `AudioBufferSourceNode` em loop, iniciado com `start(when, offset)` alinhado ao início do loop, o que mantém todas as faixas em fase. Metrônomo e bateria são agendados por um scheduler com lookahead: um timer curto agenda no relógio do áudio os eventos dos próximos 100 ms.
