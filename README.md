# Céu de Aço

Combate aéreo 3D a baixa altitude no navegador. Three.js + TypeScript (strict) + Vite, sem backend e sem assets externos: terreno, modelos, texturas e áudio são gerados por código.

**Jogar:** https://erospgomes.github.io/Reviva/

## Jogo

- **Missão**: neutralizar as bases A, B e C (antiaéreas, blindados, combustível) e derrubar ondas de caças com IA crescente.
- **Armas**: canhão com superaquecimento, 2 trilhos de míssil com trava (1,3 s no cone) e recarga, flares contra mísseis.
- **Controles**: teclado/mouse, toque (manche virtual + trilho de potência + botões) e gamepad, sem configuração.
- **Mundo**: 18 × 18 km, lavouras em grade com fileiras de plantio no shader, fazendas com silos, cercas vivas, serras na borda.

### Dificuldade

| | Recruta | Piloto | Ás |
|---|---|---|---|
| Habilidade da IA | −0,18 | base | +0,2 |
| Dano recebido | ×0,6 | ×1 | ×1,25 |
| Antiaérea (dano / intervalo) | ×0,55 / ×1,4 | ×1 / ×1 | ×1,3 / ×0,75 |
| Reparo | 8 HP/s após 4 s | 5 HP/s após 6 s | 3 HP/s após 9 s |
| Caças por onda | −1 | base | +1 |
| Pontos | ×0,75 | ×1 | ×1,5 |

### Armamento

| Metralhadora | Cadência | Dano/tiro | Alcance | Característica |
|---|---|---|---|---|
| .30 (7,62 mm) | 30/s | 4,5 | ~1,3 km | aquece devagar (~95 tiros) |
| .50 (12,7 mm) | 15/s | 10,5 | ~2 km | maior alcance |
| 20 mm | 22/s | 12 + estilhaço | ~1,9 km | maior dano, superaquece em ~1,5 s |

| Míssil | Trava | Alcance | Alvos | Detalhe |
|---|---|---|---|---|
| IR Víbora | 1 s | 3,2 km | ar e solo | ágil, flares enganam fácil |
| Radar Lança | 2 s | 6 km | ar | 900 m/s, resiste a 75% dos flares |
| AGM Martelo | 0,8 s | 3,6 km | solo | ogiva de 220, raio de 60 m |
| Foguetes Enxame | — | — | qualquer | salva de 8 não guiados |

Cada tipo tem trilhos e recarga próprios; trocar não zera a recarga.

### Boosts

| Gatilho | Recompensa |
|---|---|
| Cada caça abatido | +30% velocidade máx. e +75% empuxo por 10 s, +10 HP |
| Sequência de 2 | Recarga rápida (×3 nos mísseis, metade do calor) por 12 s |
| Sequência de 3 | Munição perfurante (×1,5 de dano) por 12 s |
| Base neutralizada | Blindagem (×0,4 de dano) por 10 s, mísseis e flares recarregados |

A sequência zera após 25 s sem abate. Boosts renovados acumulam até o dobro da duração.

| Teclado | Ação |
|---|---|
| W/S ou ↑/↓ | arfagem |
| A/D ou ←/→ | rolagem |
| Q/E | leme |
| R ou Shift / F | potência + / − |
| Espaço ou clique | canhão |
| Enter, M ou clique direito | míssil |
| T / G | trocar míssil / metralhadora |
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
  loadout.ts  tabelas de dificuldade, metralhadoras, mísseis e boosts (balanceamento em um só lugar)
  hud.ts      bússola, fitas de velocidade/altitude, escada de arfagem, painel de armas e alvo, radar
  input.ts, audio.ts (Web Audio sintetizado), game.ts, main.ts
```
