import { useId } from "react";
import { motion } from "framer-motion";
import type { Card } from "../game/types";
import { RANK_SHORT } from "../game/types";

const SUIT_GLYPH: Record<string, string> = { Q: "♥", K: "♦", A: "♣", JKR: "★" };

type Size = "sm" | "md" | "lg";

interface FaceProps {
  rank: string;
  size?: Size;
  devil?: boolean;
}

function DevilFace({ rank, size }: { rank: string; size: Size }) {
  const glyph = SUIT_GLYPH[rank] ?? "?";
  const short = RANK_SHORT[rank as keyof typeof RANK_SHORT] ?? rank[0];

  return (
    <div className={`card-face card-face--${size} is-devil`}>
      <span className="devil-card__grain" aria-hidden="true" />
      <div className="card-corner card-corner--tl devil-card__corner">
        <span>{short}</span>
        <span className="card-suit">{glyph}</span>
      </div>

      <div className="devil-card__sigil" aria-hidden="true">
        <svg viewBox="0 0 100 132">
          <path
            className="devil-card__horn"
            d="M42 38 C28 30 18 18 18 5 C32 10 41 19 47 30 Z"
          />
          <path
            className="devil-card__horn"
            d="M58 38 C72 30 82 18 82 5 C68 10 59 19 53 30 Z"
          />
          <path
            className="devil-card__mask"
            d="M50 25 C72 25 84 41 80 66 C77 86 66 102 50 116 C34 102 23 86 20 66 C16 41 28 25 50 25 Z"
          />
          <path className="devil-card__brow" d="M29 54 L45 49 L40 64 L27 61 Z" />
          <path className="devil-card__brow" d="M71 54 L55 49 L60 64 L73 61 Z" />
          <path className="devil-card__nose" d="M50 61 L43 79 L50 76 L57 79 Z" />
          <path className="devil-card__mouth" d="M34 88 Q50 101 66 88 Q61 108 50 114 Q39 108 34 88 Z" />
          <path className="devil-card__cut" d="M50 31 V48 M31 73 L42 78 M69 73 L58 78" />
          <circle className="devil-card__eye" cx="36" cy="58" r="3.4" />
          <circle className="devil-card__eye" cx="64" cy="58" r="3.4" />
        </svg>
      </div>

      <span className="devil-card__title">Дьявол</span>
      <span className="devil-card__seal" aria-hidden="true">VI</span>

      <div className="card-corner card-corner--br devil-card__corner">
        <span>{short}</span>
        <span className="card-suit">{glyph}</span>
      </div>
      <div className="card-frame devil-card__frame" />
    </div>
  );
}

function JokerFace({ size }: { size: Size }) {
  return (
    <div className={`card-face card-face--${size} is-joker`}>
      <span className="joker-card__grain" aria-hidden="true" />

      <div className="card-corner card-corner--tl joker-card__corner">
        <span>J</span>
        <span className="card-suit">★</span>
      </div>

      <div className="joker-card__figure" aria-hidden="true">
        <svg viewBox="0 0 100 132">
          {/* Маротта: посох с головой шута в правой руке */}
          <path className="joker-stick" d="M75.8 63.6 L81.6 48.6" />
          {/* Руки */}
          <path className="joker-arm" d="M40.5 73.5 C32.5 77 26.5 83 24.8 91" />
          <path className="joker-arm" d="M59.5 73.5 C67 76.5 71.5 73.5 74 67.5" />
          {/* Ноги в туфлях с загнутыми носками */}
          <path className="joker-arm" d="M46.5 97.5 C46.2 104 41.5 108.6 35 108.4 C32 108.3 30 106.9 28.7 104.9" />
          <path className="joker-arm" d="M53.5 97.5 C53.8 104 58.5 108.6 65 108.4 C68 108.3 70 106.9 71.3 104.9" />
          <path className="joker-curl" d="M28.7 104.9 C27 102.7 28 100.2 30.5 100" />
          <path className="joker-curl" d="M71.3 104.9 C73 102.7 72 100.2 69.5 100" />
          <circle className="joker-bell joker-bell--sm" cx="31.6" cy="99.4" r="1.9" />
          <circle className="joker-bell joker-bell--sm" cx="68.4" cy="99.4" r="1.9" />
          {/* Кафтан арлекина */}
          <path className="joker-body" d="M39 71.5 L61 71.5 L56.5 98 L43.5 98 Z" />
          <rect className="joker-diamond" x="-2.6" y="-2.6" width="5.2" height="5.2" transform="translate(44.8 79.5) rotate(45)" />
          <rect className="joker-diamond" x="-2.6" y="-2.6" width="5.2" height="5.2" transform="translate(55.2 79.5) rotate(45)" />
          <rect className="joker-diamond" x="-2.6" y="-2.6" width="5.2" height="5.2" transform="translate(50 87.5) rotate(45)" />
          <path className="joker-belt" d="M43.9 92.8 L56.1 92.8 L55.4 96.9 L44.6 96.9 Z" />
          {/* Манжеты и кисти */}
          <circle className="joker-cuff" cx="24.8" cy="91" r="3.1" />
          <circle className="joker-hand" cx="23.2" cy="95.3" r="2.9" />
          <circle className="joker-cuff" cx="74" cy="67.5" r="3.1" />
          <circle className="joker-hand" cx="75.8" cy="63.6" r="2.9" />
          {/* Голова маротты */}
          <path className="joker-hat-horn" d="M80 42.5 L78.2 37.6 L82 39.8 Z" />
          <path className="joker-hat-horn joker-hat-horn--gold" d="M86 42.5 L87.8 37.6 L84 39.8 Z" />
          <circle className="joker-bell joker-bell--sm" cx="77.9" cy="36.6" r="1.1" />
          <circle className="joker-bell joker-bell--sm" cx="88.1" cy="36.6" r="1.1" />
          <circle className="joker-face joker-face--mini" cx="83" cy="45.8" r="4.8" />
          <circle className="joker-dot" cx="81.4" cy="45.4" r="0.55" />
          <circle className="joker-dot" cx="84.6" cy="45.4" r="0.55" />
          <path className="joker-smile joker-smile--mini" d="M81.6 47.6 Q83 48.9 84.4 47.6" />
          {/* Воротник-жабо */}
          <ellipse className="joker-collar" cx="36.5" cy="70.5" rx="4.7" ry="6.2" />
          <ellipse className="joker-collar joker-collar--gold" cx="43.25" cy="70.5" rx="4.7" ry="6.2" />
          <ellipse className="joker-collar" cx="50" cy="70.5" rx="4.7" ry="6.2" />
          <ellipse className="joker-collar joker-collar--gold" cx="56.75" cy="70.5" rx="4.7" ry="6.2" />
          <ellipse className="joker-collar" cx="63.5" cy="70.5" rx="4.7" ry="6.2" />
          {/* Лицо */}
          <circle className="joker-face" cx="50" cy="53" r="14.5" />
          <circle className="joker-blush" cx="42.6" cy="57.8" r="2.7" />
          <circle className="joker-blush" cx="57.4" cy="57.8" r="2.7" />
          <circle className="joker-nose" cx="50" cy="55.6" r="1.3" />
          <path className="joker-line" d="M42.3 52.6 Q45.1 49.2 47.9 52.6" />
          <path className="joker-line" d="M52.1 52.6 Q54.9 49.2 57.7 52.6" />
          <path className="joker-smile" d="M44.2 58.6 Q50 63.4 55.8 58.6" />
          {/* Колпак: три рожка с бубенцами */}
          <path className="joker-hat-horn joker-hat-horn--gold" d="M38.5 43.5 C29.5 44.5 21.5 41.5 15.8 34 C14.2 31.8 16.4 29.4 18.6 31 C24.5 36.6 32 40 40.5 40.2 Z" />
          <path className="joker-hat-horn" d="M61.5 43.5 C70.5 44.5 78.5 41.5 84.2 34 C85.8 31.8 83.6 29.4 81.4 31 C75.5 36.6 68 40 59.5 40.2 Z" />
          <path className="joker-hat-horn joker-hat-horn--gold" d="M47.5 39.8 C45 30 47.5 20 53 13 C54.6 11 57 12.8 55.7 15 C51.8 22 51.6 30 53.2 39.8 Z" />
          <path className="joker-hatband" d="M35.5 46.5 C38.5 41.5 43.5 38.8 50 38.8 C56.5 38.8 61.5 41.5 64.5 46.5 C60.5 49.8 55.8 51.2 50 51.2 C44.2 51.2 39.5 49.8 35.5 46.5 Z" />
          <circle className="joker-bell" cx="15.2" cy="31.6" r="2.9" />
          <circle className="joker-bell" cx="84.8" cy="31.6" r="2.9" />
          <circle className="joker-bell" cx="54.4" cy="11.4" r="2.9" />
        </svg>
      </div>

      <span className="joker-card__title">Joker</span>
      <span className="joker-card__seal" aria-hidden="true">★</span>

      <div className="card-corner card-corner--br joker-card__corner">
        <span>J</span>
        <span className="card-suit">★</span>
      </div>
      <div className="card-frame joker-card__frame" />
    </div>
  );
}

export function CardFace({ rank, size = "md", devil = false }: FaceProps) {
  if (devil) return <DevilFace rank={rank} size={size} />;
  if (rank === "JKR") return <JokerFace size={size} />;

  const glyph = SUIT_GLYPH[rank] ?? "?";
  const short = RANK_SHORT[rank as keyof typeof RANK_SHORT] ?? rank[0];
  return (
    <div className={["card-face", `card-face--${size}`].join(" ")}>
      <div className="card-corner card-corner--tl">
        <span>{short}</span>
        <span className="card-suit">{glyph}</span>
      </div>
      <div className="card-center">
        <svg viewBox="0 0 60 80" aria-hidden="true">
          <text
            x="30"
            y="52"
            textAnchor="middle"
            fontSize="42"
            fontWeight="700"
            fill="#221c20"
            fontFamily="'Russo One', system-ui, sans-serif"
          >
            {short}
          </text>
          <text x="30" y="72" textAnchor="middle" fontSize="20" fill="#8c1f28">
            {glyph}
          </text>
        </svg>
      </div>
      <div className="card-corner card-corner--br">
        <span>{short}</span>
        <span className="card-suit">{glyph}</span>
      </div>
      <div className="card-frame" />
    </div>
  );
}

function CardBack({ size = "md" }: { size?: Size }) {
  const patternId = `card-lattice-${useId().replace(/:/g, "")}`;

  return (
    <div className={`card-back card-back--${size}`}>
      <svg viewBox="0 0 60 84" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern
            id={patternId}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <rect width="10" height="10" fill="#5a1420" />
            <path
              d="M0 10 L10 0 M-2 2 L2 -2 M8 12 L12 8"
              stroke="#7d2230"
              strokeWidth="1.4"
            />
          </pattern>
        </defs>
        <rect x="3" y="3" width="54" height="78" rx="4" fill={`url(#${patternId})`} />
        <rect
          x="6.5"
          y="6.5"
          width="47"
          height="71"
          rx="3"
          fill="none"
          stroke="#c9a24b"
          strokeWidth="1.2"
          opacity="0.85"
        />
        <circle cx="30" cy="42" r="11" fill="#43101a" stroke="#c9a24b" strokeWidth="1.2" />
        <text x="30" y="48" textAnchor="middle" fontSize="15" fill="#c9a24b">
          ?
        </text>
      </svg>
    </div>
  );
}

interface Props {
  card?: Card;
  faceUp?: boolean;
  size?: Size;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  devil?: boolean;
  /** Карта годится под номинал стола — подсвечиваем кромку. */
  matchesTable?: boolean;
  /** Номер для подсказки горячей клавиши. */
  index?: number;
}

/** Карта: рубашка по умолчанию, с анимацией переворота при вскрытии. */
export function PlayingCard({
  card,
  faceUp = false,
  size = "md",
  selected = false,
  onClick,
  disabled = false,
  devil = false,
  matchesTable = false,
  index,
}: Props) {
  const interactive = !!onClick && !disabled;
  const label = card
    ? `${card.rank === "JKR" ? "Джокер" : card.rank}${devil ? ", Дьявол" : ""}${
        selected ? ", выбрана" : ""
      }`
    : "Карта рубашкой вверх";

  return (
    <motion.div
      className={[
        "playing-card",
        `playing-card--${size}`,
        selected ? "is-selected" : "",
        disabled ? "is-disabled" : "",
        interactive ? "is-clickable" : "",
        matchesTable ? "is-match" : "",
        devil ? "is-devil-card" : "",
      ].join(" ")}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "checkbox" : undefined}
      aria-checked={interactive ? selected : undefined}
      aria-label={interactive ? label : undefined}
      tabIndex={interactive ? 0 : undefined}
      whileHover={interactive ? { y: -14 } : undefined}
      whileTap={interactive ? { scale: 0.97 } : undefined}
      animate={{ rotateY: faceUp ? 0 : 180 }}
      transition={{ duration: 0.45, ease: [0.2, 0.9, 0.25, 1] }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className="card-side card-front" style={{ transform: "rotateY(0deg)" }}>
        {card ? (
          <CardFace rank={card.rank} size={size} devil={devil} />
        ) : (
          <CardBack size={size} />
        )}
      </div>
      <div className="card-side" style={{ transform: "rotateY(180deg)" }}>
        <CardBack size={size} />
      </div>
      {index !== undefined && interactive && (
        <span className="playing-card__key" aria-hidden="true">
          {index}
        </span>
      )}
    </motion.div>
  );
}
