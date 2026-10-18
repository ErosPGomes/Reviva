# Céu de Aço

Combate aéreo 3D a baixa altitude no navegador. Three.js + TypeScript (strict) + Vite, sem backend e sem assets externos: terreno, modelos, texturas e áudio são gerados por código.

**Jogar:** https://erospgomes.github.io/Reviva/

## Jogo

- **Missão**: neutralizar as bases A, B e C (antiaéreas, blindados, combustível) e derrubar ondas de caças com IA crescente.
- **Armas**: canhão com superaquecimento, 2 trilhos de míssil com trava (1,3 s no cone) e recarga, flares contra mísseis.
- **Controles**: teclado/mouse, toque (manche virtual + trilho de potência + botões) e gamepad, sem configuração.
- **Mundo**: 18 × 18 km, lavouras em grade com fileiras de plantio no shader, fazendas com silos, cercas vivas, serras na borda e uma baía ao sul com o porta-aviões.
- **Hangar no menu**: prévia 3D do caça (girando, com trem baixado e o míssil escolhido nos cabides), do míssil e da metralhadora (rajada com traçante na cor real), com barras comparativas: velocidade/agilidade/blindagem, alcance/trava/dano/raio/resistência a flares, cadência/dano/alcance/rajada.

### Porta-aviões

Toda surtida começa no convés (escala de um classe Nimitz): defletor de jato ergue, o motor vai à potência máxima e a catapulta leva o caça a ~300 km/h em 126 m; o nariz sobe, o trem recolhe e o controle volta ao jogador. **Espaço** (ou CANHÃO no toque) antecipa o lançamento. Inimigos e objetivos só começam depois da decolagem. O navio é sólido: dá para bater na ilha.

### Salva naval e conquistas

16 células de lançamento vertical na popa disparam mísseis guiados por datalink (subida vertical, 170 de dano, quase imunes a flares; se o alvo cai, o míssil é redirecionado ao inimigo mais próximo). **V** lança 4 contra os caças mais próximos; sem caças, contra alvos em solo. Abates da salva contam para os objetivos, mas não para a sequência.

| Conquista | Como | Recompensa |
|---|---|---|
| Catapulta! | decolar do porta-aviões | — |
| **Guardião da Frota** | 3 abates em sequência | libera a salva naval de vez: cada surtida começa com 1; +1 a cada 3 abates seguidos ou base neutralizada (máx. 2) |
| Fogo do Almirante | abater um caça com a salva naval | — |

Conquistas ficam salvas no navegador e aparecem no menu.

### Modos

- **Campanha** (5 fases): 1 Primeiro contato (3 caças) → 2 Rota dos anéis (3 anéis + 4 alvos) → 3 Silêncio na base A → 4 Tempestade (bases B e C + 4 caças) → 5 O Ás inimigo (chefe com 320 de vida). Concluir uma fase repara, recarrega e vale +500.
- **Sobrevivência**: ondas infinitas; as bases são reocupadas 35 s depois de todas caírem.

### Caças

| | Ponto forte | Custo |
|---|---|---|
| Falcão | equilibrado | — |
| Espectro (furtivo) | inimigo trava 80% mais devagar, antiaérea enxerga menos, o mais ágil | 80 de vida, 2 flares |
| Javali (ataque ao solo) | 170 de vida, blindagem, metralhadora ×2,2 em solo, 3 trilhos por míssil | o mais lento |
| Relâmpago (interceptador) | 1370 km/h, trava 35% mais longe, recarga 25% mais rápida | curva mais aberta |

### Drone (MQ-9)

A barra roxa enche com abates (+34%), alvos em solo (+12%), bases (+25%) e anéis roxos (+30%). Cheia, **B** chama o drone: 25 s de câmera térmica (FLIR branco-quente) a 2 km de altura, enquanto o caça segue no piloto automático e não pode ser atingido. Retículo gruda em alvos próximos e o laser os acompanha.

- **AGM-114 Hellfire** (padrão): guiagem laser semiativa, 260 de dano, raio de 26 m; corrige a mira até o impacto.
- **AGM-114N termobárico** (**T** troca): 190 de dano, raio de 75 m, para grupos e bases.

6 disparos por missão. Tomahawk não serve aqui: é míssil de cruzeiro naval para alvos fixos a centenas de km.

### Anéis

7 anéis no ar (raio 42 m): verde repara 35, azul dá boost aleatório, branco recarrega mísseis/flares e esfria a metralhadora, roxo carrega o drone. Reaparecem em outro ponto após 25 s.

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
| B | drone (quando a barra roxa estiver cheia) |
| V | salva naval do porta-aviões (após a conquista) |
| X | flares |
| C | câmera |
| Esc | pausa |

## Desenvolvimento

```bash
npm install
npm run dev     # servidor local
npm test        # modelo de voo, terreno, armas, lavouras, baía/catapulta, salva naval, conquistas
npm run build   # typecheck + build estático em dist/
```

Push em `main` publica no GitHub Pages via `.github/workflows/deploy.yml`.

## Estrutura

```
src/
  flight.ts   modelo de voo (empuxo/arrasto/gravidade, estol, teto, modo arcade)
  terrain.ts  grade de alturas compartilhada entre malha e colisão (com a baía: colisão na superfície da água)
  fields.ts   layout das lavouras + textura RGBA (alfa = orientação das fileiras)
  world.ts    céu, luz, árvores/fazendas instanciadas, nuvens
  ai.ts       piloto inimigo bank-to-turn (chão > arena > evasão > ataque)
  weapons.ts  projéteis (teste por segmento), mísseis com antecipação, flares
  particles.ts / effects.ts  billboards instanciados (1 draw call por fila)
  fighters.ts caças jogáveis (voo, vida, furtividade, trilhos, multiplicadores)
  campaign.ts fases e objetivos (funções puras, testadas)
  carrier.ts  porta-aviões: casco, convés pintado em canvas, catapulta, defletor, células de lançamento
  naval.ts    míssil naval e escolha de alvos da salva; achievements.ts conquistas persistentes
  hangar.ts   prévia 3D do menu (um renderer, três recortes); stats.ts fichas comparativas
  drone.ts    drone com Hellfire guiado a laser; thermal.ts visão térmica (pós-processo + materiais quentes)
  rings.ts    anéis de recompensa e teste de travessia
  loadout.ts  tabelas de dificuldade, metralhadoras, mísseis e boosts (balanceamento em um só lugar)
  hud.ts      bússola, fitas de velocidade/altitude, escada de arfagem, painel de armas e alvo, radar
  input.ts, audio.ts (Web Audio sintetizado), game.ts, main.ts
```
