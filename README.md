# Céu de Aço

Combate aéreo 3D a baixa altitude no navegador. Three.js + TypeScript (strict) + Vite, sem backend e sem assets externos: terreno, modelos, texturas e áudio são gerados por código.

**Jogar:** https://erospgomes.github.io/Reviva/

## Jogo

- **Missão**: neutralizar as bases A, B e C (antiaéreas, blindados, combustível) e derrubar ondas de caças com IA crescente.
- **Armas**: canhão com superaquecimento, 2 trilhos de míssil com trava (1,3 s no cone) e recarga, flares contra mísseis.
- **Controles**: teclado/mouse, toque (manche virtual + trilho de potência + botões) e gamepad, sem configuração.
- **Mundo**: 18 × 18 km, lavouras em grade com fileiras de plantio no shader, fazendas com silos, cercas vivas, serras na borda.

| Teclado | Ação |
|---|---|
| W/S ou ↑/↓ | arfagem |
| A/D ou ←/→ | rolagem |
| Q/E | leme |
| R ou Shift / F | potência + / − |
| Espaço ou clique | canhão |
| Enter, M ou clique direito | míssil |
| X | flares |
| C | câmera |
| Esc | pausa |

## Desenvolvimento

```bash
npm install
npm run dev     # servidor local
npm test        # modelo de voo, terreno, geometria de armas, lavouras
npm run build   # typecheck + build estático em dist/
```

Push em `main` publica no GitHub Pages via `.github/workflows/deploy.yml`.

## Estrutura

```
src/
  flight.ts   modelo de voo (empuxo/arrasto/gravidade, estol, teto, modo arcade)
  terrain.ts  grade de alturas compartilhada entre malha e colisão
  fields.ts   layout das lavouras + textura RGBA (alfa = orientação das fileiras)
  world.ts    céu, luz, árvores/fazendas instanciadas, nuvens
  ai.ts       piloto inimigo bank-to-turn (chão > arena > evasão > ataque)
  weapons.ts  projéteis (teste por segmento), mísseis com antecipação, flares
  particles.ts / effects.ts  billboards instanciados (1 draw call por fila)
  hud.ts, input.ts, audio.ts (Web Audio sintetizado), game.ts, main.ts
```
