import type { CharacterId } from "../game/types";

const AVATAR_IMAGES: Record<CharacterId, string> = {
  scubby: "/images/characters/scubby.webp",
  foxy: "/images/characters/foxy.webp",
  bristle: "/images/characters/bristle.webp",
  toar: "/images/characters/toar.webp",
  cupcake: "/images/characters/cupcake.webp",
  gerk: "/images/characters/gerk.webp",
};

interface Props {
  characterId: CharacterId;
  size?: number;
  className?: string;
}

/** Кинематографичный растровый портрет персонажа. */
export function Avatar({ characterId, size = 72, className }: Props) {
  const classes = ["avatar-image", className].filter(Boolean).join(" ");

  return (
    <img
      src={AVATAR_IMAGES[characterId]}
      width={size}
      height={size}
      className={classes}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}
