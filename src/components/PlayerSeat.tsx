import { AnimatePresence, motion } from "framer-motion";
import type { PlayerState, CharacterId } from "../game/types";
import { CHAMBERS, HAND_SIZE } from "../game/types";
import { CHARACTER_BY_ID } from "../game/characters";
import { Avatar } from "./Avatar";
import { plural } from "../game/plural";

interface Props {
  player: PlayerState;
  active: boolean;
  isStarter?: boolean;
  /** Сколько карт игрок положил последней выкладкой (0 — не он). */
  lastPlayCount?: number;
  taunt?: string | null;
}

export function PlayerSeat({
  player,
  active,
  isStarter = false,
  lastPlayCount = 0,
  taunt = null,
}: Props) {
  const character = player.characterId
    ? CHARACTER_BY_ID.get(player.characterId as CharacterId)
    : null;

  const pullsMade = CHAMBERS - player.chambers.length;
  const left = Math.max(1, player.chambers.length);
  const doomed = player.alive && player.chambers.length <= 1;

  const odds = !player.alive
    ? "мёртв"
    : left > 1
      ? `следующий спуск — 1 из ${left}`
      : "следующий спуск — выстрел неизбежен";

  return (
    <div
      className={[
        "seat",
        active ? "is-active" : "",
        !player.alive ? "is-dead" : "",
        doomed ? "is-doomed" : "",
      ].join(" ")}
    >
      <AnimatePresence>
        {taunt && player.alive && (
          <motion.div
            className="seat__taunt"
            initial={{ opacity: 0, x: "-50%", y: 8, scale: 0.9 }}
            animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
            exit={{ opacity: 0, x: "-50%", y: -6, scale: 0.95 }}
            transition={{ duration: 0.22 }}
          >
            {taunt}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="seat__avatar">
        <Avatar characterId={character?.id ?? "foxy"} size={64} />
        {!player.alive && (
          <span className="seat__skull" aria-label="мёртв">
            ✕
          </span>
        )}
        {active && player.alive && (
          <span className="seat__thinking" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        {lastPlayCount > 0 && (
          <motion.span
            className="seat__lastplay"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            title={`В последней выкладке: ${lastPlayCount}`}
          >
            +{lastPlayCount}
          </motion.span>
        )}
      </div>

      <div className="seat__meta">
        <div className="seat__name">
          {player.name}
          {isStarter && (
            <span className="seat__starter" title="Начинал раунд">
              ●
            </span>
          )}
        </div>

        <div className="seat__resources">
          <div
            className="seat__bullets"
            title={`Осечек пережито: ${pullsMade} · ${odds}`}
            aria-label={`${player.name}: ${odds}`}
          >
            {Array.from({ length: CHAMBERS }).map((_, i) => (
              <span
                key={i}
                className={`seat__bullet ${i < pullsMade ? "is-spent" : ""}`}
              />
            ))}
          </div>

          <div className="seat__cards" title={`Карт на руках: ${player.hand.length}`}>
            <span className="seat__cardcount" aria-hidden="true">
              {player.hand.length} {plural(player.hand.length, "карта", "карты", "карт")}
            </span>
            {Array.from({ length: Math.min(player.hand.length, HAND_SIZE) }).map(
              (_, i) => (
                <span key={i} className="mini-card" />
              ),
            )}
            {player.alive && player.hand.length === 0 && (
              <span className="seat__nocards">пусто</span>
            )}
          </div>
        </div>
      </div>

      {!player.alive && <div className="seat__deadlabel">мёртв</div>}
    </div>
  );
}
