import { forwardRef, type ReactElement } from "react";
import type { RevolverPose } from "../game/revolverTimeline";
import type { CartridgeState } from "../game/revolverVisual";

const fmt = (v: number) => (Math.abs(v) < 1e-4 ? "0" : v.toFixed(2));

const CHAMBER_R = 15;
const CHAMBER_RING = 44;
const CYL_R = 68;
const CYL_X = 444;
const HAMMER_PIVOT = { x: 300, y: 218 };
const TRIGGER_PIVOT = { x: 376, y: 254 };
const MUZZLE = { x: 734, y: 200 };

/** Детерминированный псевдослучайный шум в [0,1) для мерцания вспышки. */
const hash = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// Непрерывный силуэт: верхняя рамка → передняя рамка → дуга рукояти → низ → задняя дуга.
const FRAME_PATH =
  "M302,154 L446,154 L446,252 L356,252 C352,282 344,312 334,338 C324,366 306,388 280,392 C254,396 232,384 236,360 C242,322 262,290 264,252 L265,190 C266,170 280,154 302,154 Z";
const GRIP_PATH =
  "M278,264 C274,290 262,320 250,352 C245,370 258,382 278,380 C300,378 316,360 324,336 C332,312 338,288 342,264 Z";

interface Props {
  pose: RevolverPose;
  /** Текущая раскладка барабана: пусто / боевой патрон / стреляная гильза. */
  cartridges: CartridgeState[];
  /** Прогресс укладки патрона по каждому слоту, 0..1. */
  drop: number[];
  className?: string;
  /** Пропускает дорогие drop-shadow фильтры — режим для слабых мобильных GPU. */
  lite?: boolean;
}

/** Канавки барабана в боковой проекции: позиция зависит от угла поворота. */
function SideFlutes({
  angle,
  opacity = 1,
}: {
  angle: number;
  opacity?: number;
}) {
  const R = 36;
  const items: ReactElement[] = [];
  for (let i = 0; i < 6; i++) {
    const th = ((angle + i * 60) * Math.PI) / 180;
    const c = Math.cos(th);
    if (c <= 0.03) continue;
    const y = 200 + R * Math.sin(th);
    const h = 3 + 10 * c;
    items.push(
      <rect
        key={i}
        x="330"
        y={fmt(y - h / 2)}
        width="82"
        height={fmt(h)}
        rx={fmt(h / 2)}
        fill="url(#rev-flute)"
        stroke="#0a0c0e"
        strokeWidth="0.8"
        opacity={fmt(opacity * (0.35 + 0.65 * c))}
      />,
    );
  }
  return <g>{items}</g>;
}

const easeOutCubicCartridge = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * Револьвер из обновлённой оригинальной анимации, встроенный в сцену рулетки:
 * раскрутка происходит на закрытом барабане в боковой проекции, канавки
 * вращаются по реальному углу, стопор подрагивает от щелчков камор, курок
 * доворачивает барабан при взводе. Без собственного фона и результирующей
 * надписи. Стрелка-указатель бойкового гнезда и врезка «вид сзади» намеренно
 * отсутствуют — положение патронов не должно выдавать исход.
 */
export const RevolverStage = forwardRef<SVGSVGElement, Props>(function RevolverStage(
  { pose, cartridges, drop, className, lite },
  ref,
) {
  const p = pose;
  const sideVis = 1 - Math.min(1, p.cylOpen * 2);
  const faceVis = Math.max(0, (p.cylOpen - 0.5) * 2);
  const craneY = 200 + 50 * faceVis;
  const faceX = CYL_X - CYL_R * faceVis;

  const zoomScale = 1 + 0.12 * p.zoom;
  const zoomDx = -24 * p.zoom;
  const zoomDy = 14 * p.zoom;

  const gunDx = -26 * p.recoil + 3 * p.shake;
  const gunDy = -9 * p.recoil - 2 * p.jolt;
  const gunRot = -7 * p.recoil + 0.6 * p.shake + 0.5 * p.jolt;

  const hammerRot = -34 * p.hammer;
  const triggerRot = 24 * p.trigger;
  // Во время взвода барабан немного доворачивается — как в настоящем револьвере.
  const sideAngle = p.spin - 14 * p.hammer;

  const flashScale = p.flash * (0.85 + 0.3 * hash(p.seed, 1));
  const flashRot = (hash(p.seed, 2) - 0.5) * 10;
  const blur = Math.min(1, Math.abs(p.spinVel) / 1);

  // В лёгком режиме отключаем только дорогие drop-shadow фильтры.
  const F = (id: string) =>
    lite && (id === "rev-shadow" || id === "rev-soft-shadow")
      ? undefined
      : `url(#${id})`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="150 90 700 380"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="rev-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a424b" />
          <stop offset="18%" stopColor="#9aa4ae" />
          <stop offset="40%" stopColor="#dbe1e6" />
          <stop offset="58%" stopColor="#7f8993" />
          <stop offset="85%" stopColor="#2f353c" />
          <stop offset="100%" stopColor="#1b1f24" />
        </linearGradient>
        <linearGradient id="rev-steel-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a3037" />
          <stop offset="30%" stopColor="#5b646e" />
          <stop offset="55%" stopColor="#3a4149" />
          <stop offset="100%" stopColor="#15181c" />
        </linearGradient>
        <linearGradient id="rev-steel-frame" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#7a838d" />
          <stop offset="25%" stopColor="#4a525a" />
          <stop offset="60%" stopColor="#30363d" />
          <stop offset="100%" stopColor="#1a1e23" />
        </linearGradient>
        <linearGradient id="rev-cyl-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f2429" />
          <stop offset="14%" stopColor="#6d7680" />
          <stop offset="34%" stopColor="#c9d1d8" />
          <stop offset="55%" stopColor="#8b949e" />
          <stop offset="82%" stopColor="#363d45" />
          <stop offset="100%" stopColor="#101317" />
        </linearGradient>
        <linearGradient id="rev-flute" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c0f12" />
          <stop offset="55%" stopColor="#2a3036" />
          <stop offset="100%" stopColor="#66707a" />
        </linearGradient>
        <radialGradient id="rev-face" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#c3cbd3" />
          <stop offset="45%" stopColor="#6f7882" />
          <stop offset="85%" stopColor="#2e343b" />
          <stop offset="100%" stopColor="#1a1e23" />
        </radialGradient>
        <radialGradient id="rev-bore" cx="45%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#000" />
          <stop offset="70%" stopColor="#0a0d10" />
          <stop offset="100%" stopColor="#3b434b" />
        </radialGradient>
        <radialGradient id="rev-brass" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff2c2" />
          <stop offset="35%" stopColor="#e4bd5d" />
          <stop offset="75%" stopColor="#a87a2a" />
          <stop offset="100%" stopColor="#6b4a14" />
        </radialGradient>
        <radialGradient id="rev-brass-spent" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#a56e2a" />
          <stop offset="45%" stopColor="#6d451a" />
          <stop offset="100%" stopColor="#2a1708" />
        </radialGradient>
        <radialGradient id="rev-primer" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#f5f7f9" />
          <stop offset="60%" stopColor="#a9b2bb" />
          <stop offset="100%" stopColor="#5b636b" />
        </radialGradient>
        <linearGradient id="rev-wood" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#8f4a22" />
          <stop offset="35%" stopColor="#5f2c10" />
          <stop offset="65%" stopColor="#7d3c18" />
          <stop offset="100%" stopColor="#3a1807" />
        </linearGradient>
        <radialGradient id="rev-flash-core" cx="30%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#ffe9a3" />
          <stop offset="70%" stopColor="#ff9a2a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff5a00" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rev-flash-cone" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#ffd35c" />
          <stop offset="70%" stopColor="#ff8a1e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ff4d00" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="rev-ground" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity="0.45" />
          <stop offset="70%" stopColor="#000" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id="rev-checker" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 2.5 H5 M2.5 0 V5" stroke="#2a1206" strokeWidth="0.8" opacity="0.6" />
        </pattern>
        <clipPath id="rev-cyl-clip">
          <rect x="312" y="162" width="120" height="76" rx="7" />
        </clipPath>
        <clipPath id="rev-grip-clip">
          <path d={GRIP_PATH} />
        </clipPath>
        <filter id="rev-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="10" floodColor="#000" floodOpacity="0.6" />
        </filter>
        <filter id="rev-soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="-6" dy="10" stdDeviation="6" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="rev-blur6" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="rev-blur14" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="rev-blur3" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Мягкая тень под оружием на полу сцены. */}
      <ellipse
        cx="490"
        cy="455"
        rx="300"
        ry="14"
        fill={lite ? "url(#rev-ground)" : "#000"}
        opacity={lite ? 1 : 0.45}
        filter={lite ? undefined : F("rev-blur14")}
      />

      {/* Подсветка сцены дульным пламенем. */}
      {p.flash > 0 && (
        <circle
          cx={MUZZLE.x}
          cy={MUZZLE.y}
          r={fmt(240 * flashScale)}
          fill="#ffb347"
          opacity={fmt(0.25 * p.flash)}
          filter={F("rev-blur14")}
        />
      )}

      {/* Камера. */}
      <g transform={`translate(${fmt(450 + zoomDx)} ${fmt(250 + zoomDy)}) scale(${fmt(zoomScale)}) translate(-450 -250)`}>
        {/* Оружие с отдачей. */}
        <g
          transform={`translate(${fmt(gunDx)} ${fmt(gunDy)}) rotate(${fmt(gunRot)} 300 380)`}
          filter={F("rev-shadow")}
        >
          {/* Курок — за рамой. */}
          <g transform={`rotate(${fmt(hammerRot)} ${HAMMER_PIVOT.x} ${HAMMER_PIVOT.y})`}>
            <path
              d="M310,224 L298,196 L292,172 C288,160 276,150 260,148 C246,147 238,158 246,167 C254,174 270,175 280,181 L286,196 L294,230 Z"
              fill="url(#rev-steel-dark)"
              stroke="#0f1215"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M252 151 l2 4 M258 150 l2 4 M264 150 l2 4 M270 151 l2 4 M276 153 l2 4" stroke="#0f1215" strokeWidth="1.1" opacity="0.9" />
            <path d="M246 158 C256 154 272 156 288 166" stroke="#b9c2cb" strokeWidth="1" fill="none" opacity="0.5" />
          </g>

          {/* Рама. */}
          <path d={FRAME_PATH} fill="url(#rev-steel-frame)" stroke="#0f1215" strokeWidth="1.5" strokeLinejoin="round" />

          {/* Рукоять. */}
          <path d={GRIP_PATH} fill="url(#rev-wood)" stroke="#2a1206" strokeWidth="1.5" />
          <g clipPath="url(#rev-grip-clip)">
            <path
              d="M252,360 C270,330 292,300 318,280 M248,372 C268,340 292,312 326,292 M262,340 C280,314 298,296 322,284 M262,384 C278,356 300,326 332,306"
              stroke="#a8592a"
              strokeWidth="1.2"
              fill="none"
              opacity="0.4"
            />
            <path d={GRIP_PATH} fill="url(#rev-checker)" />
            <path d="M278,264 L342,264 L339,290 L275,286 Z" fill="url(#rev-wood)" opacity="0.75" />
            <path d="M254,364 C262,340 274,318 290,300" stroke="#ffd9b0" strokeWidth="1" fill="none" opacity="0.25" />
          </g>
          <circle cx="292" cy="328" r="4.5" fill="url(#rev-primer)" stroke="#333" strokeWidth="0.8" />
          <path d="M289 328 h6" stroke="#333" strokeWidth="1" />

          {/* Блики и линии рамы. */}
          <path d="M300 157 H442" stroke="#c3ccd5" strokeWidth="1.2" opacity="0.6" />
          <path d="M268 190 C269 174 282 158 300 158" stroke="#c3ccd5" strokeWidth="1" fill="none" opacity="0.45" />
          <path d="M268 254 C266 292 246 322 240 360" stroke="#000" strokeWidth="1" fill="none" opacity="0.35" />
          <path d="M292 200 C296 230 300 246 318 250" stroke="#000" strokeWidth="0.8" fill="none" opacity="0.35" />

          {/* Защёлка барабана. */}
          <rect x={fmt(272 + 7 * p.latch)} y="188" width="24" height="12" rx="3" fill="url(#rev-steel)" stroke="#0f1215" strokeWidth="0.9" />
          <path d={`M${fmt(276 + 7 * p.latch)} 191 h16 M${fmt(276 + 7 * p.latch)} 194 h16 M${fmt(276 + 7 * p.latch)} 197 h16`} stroke="#1a1e23" strokeWidth="0.8" />
          <circle cx="284" cy="238" r="3" fill="url(#rev-primer)" stroke="#111" strokeWidth="0.7" />
          <circle cx="330" cy="246" r="2.4" fill="url(#rev-primer)" stroke="#111" strokeWidth="0.7" />

          {/* Спусковая скоба. */}
          <path
            d="M360,254 L360,284 C360,308 376,320 396,320 C418,320 432,306 432,284 L432,254"
            fill="none"
            stroke="#2c333a"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M360,254 L360,284 C360,308 376,320 396,320 C418,320 432,306 432,284 L432,254"
            fill="none"
            stroke="#88919b"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.55"
          />

          {/* Спусковой крючок. */}
          <g transform={`rotate(${fmt(triggerRot)} ${TRIGGER_PIVOT.x} ${TRIGGER_PIVOT.y})`}>
            <path
              d="M370,252 L384,252 C387,266 386,282 380,294 C377,300 368,299 366,292 C363,280 365,264 370,252 Z"
              fill="url(#rev-steel)"
              stroke="#0f1215"
              strokeWidth="1.2"
            />
            <path d="M371 260 C369 276 370 286 374 293" stroke="#fff" strokeWidth="1" opacity="0.35" fill="none" />
          </g>

          {/* Экстрактор и ствол. */}
          <rect x="440" y="217" width="150" height="14" rx="6" fill="url(#rev-steel-dark)" stroke="#0f1215" strokeWidth="1" />
          <rect x="590" y="220" width="18" height="8" rx="4" fill="url(#rev-steel)" stroke="#0f1215" strokeWidth="0.8" />
          <rect x="440" y="183" width="294" height="34" rx="3" fill="url(#rev-steel)" stroke="#0f1215" strokeWidth="1.2" />
          <rect x="440" y="178" width="288" height="7" rx="2" fill="#20252b" />
          <path d="M444 180 H724" stroke="#8d97a1" strokeWidth="0.8" opacity="0.6" />
          <path d="M446 188 H728" stroke="#ffffff" strokeWidth="1.4" opacity="0.45" />
          <path d="M446 212 H728" stroke="#000" strokeWidth="1.2" opacity="0.5" />
          <path d="M704,183 L708,167 L720,167 L723,183 Z" fill="url(#rev-steel-dark)" stroke="#0f1215" strokeWidth="1" />
          <rect x="724" y="180" width="11" height="40" rx="3" fill="url(#rev-steel-dark)" stroke="#0f1215" strokeWidth="1" />

          {/* Окно барабана. */}
          <rect x="308" y="164" width="130" height="72" rx="2" fill="#07090b" />
          <rect x="308" y="164" width="130" height="10" fill="#000" opacity="0.7" />

          {/* Кран — виден только при откинутом барабане. */}
          {faceVis > 0 && (
            <g opacity={fmt(Math.min(1, faceVis * 2))}>
              <line x1={CYL_X - 6} y1={236} x2={fmt(faceX)} y2={fmt(craneY)} stroke="#2b3138" strokeWidth="14" strokeLinecap="round" />
              <line x1={CYL_X - 6} y1={236} x2={fmt(faceX)} y2={fmt(craneY)} stroke="#77818b" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
              <rect x="428" y="194" width="14" height="48" rx="4" fill="url(#rev-steel-dark)" stroke="#0f1215" strokeWidth="1" />
            </g>
          )}

          {/* Барабан сбоку (закрыт) — здесь и происходит раскрутка. */}
          {sideVis > 0.005 && (
            <g
              transform={`translate(${CYL_X - 12} 0) scale(${fmt(sideVis)} 1) translate(-432 0)`}
              data-testid="revolver-cylinder-side"
            >
              <rect x="312" y="162" width="120" height="76" rx="7" fill="url(#rev-cyl-side)" stroke="#0f1215" strokeWidth="1.2" />
              <g clipPath="url(#rev-cyl-clip)">
                {blur > 0.02 &&
                  [1, 2, 3].map((k) => (
                    <SideFlutes key={k} angle={sideAngle - p.spinVel * 9 * k} opacity={blur * (0.45 - k * 0.1)} />
                  ))}
                <SideFlutes angle={sideAngle} opacity={1 - 0.4 * blur} />
                {/* Размытая полоса при быстрой раскрутке. */}
                {blur > 0.05 && (
                  <rect x="330" y="166" width="82" height="68" fill="#0c0f12" opacity={fmt(0.25 * blur)} />
                )}
                <rect x="312" y="162" width="10" height="76" fill="#1a1e23" />
                <rect x="322" y="162" width="2" height="76" fill="#8a949e" opacity="0.5" />
                <rect x="426" y="162" width="6" height="76" fill="#d5dce2" opacity="0.3" />
              </g>
              <path d="M322 167 H426" stroke="#fff" strokeWidth="1.2" opacity="0.5" />
              <path d="M322 234 H426" stroke="#000" strokeWidth="1.2" opacity="0.6" />
              {/* Стопор барабана — подрагивает от щелчков по каморам. */}
              <rect
                x="370"
                y={fmt(236 + 2 * Math.abs(Math.sin((p.spin * Math.PI) / 60)) * blur)}
                width="14"
                height="6"
                rx="2"
                fill="url(#rev-steel-dark)"
                stroke="#0f1215"
                strokeWidth="0.8"
              />
            </g>
          )}

          {/* Барабан откинут — торец с патронами, вкладывание. Без метки гнезда. */}
          {faceVis > 0.005 && (
            <g
              transform={`translate(${CYL_X} ${fmt(craneY)}) scale(${fmt(faceVis)} 1) translate(${-CYL_R} 0)`}
              filter={F("rev-soft-shadow")}
              data-testid="revolver-cylinder"
            >
              <g transform={`rotate(${fmt(p.spin)})`}>
                <CylinderFace cartridges={cartridges} drop={drop} />
              </g>
              {/* Блик на ободе — фиксирован относительно света, не указатель. */}
              <circle
                r={CYL_R}
                fill="none"
                stroke="#dfe5ea"
                strokeWidth="1.5"
                opacity="0.55"
                strokeDasharray="60 340"
                transform="rotate(-140)"
              />
            </g>
          )}

          {/* Вспышка в зазоре барабан-ствол. */}
          {p.flash > 0 && (
            <ellipse cx="437" cy="200" rx={fmt(6 * flashScale)} ry={fmt(42 * flashScale)} fill="#ffd27a" opacity={fmt(p.flash)} filter={F("rev-blur3")} />
          )}

          {/* Дульная вспышка. */}
          {p.flash > 0.01 && (
            <g transform={`translate(${MUZZLE.x} ${MUZZLE.y}) rotate(${fmt(flashRot)}) scale(${fmt(flashScale)})`} data-testid="muzzle-flash">
              <circle r="90" fill="#ff8a1e" opacity="0.35" filter={F("rev-blur14")} />
              <path d="M0,-16 L52,-44 L100,-28 L150,-6 L150,6 L100,28 L52,44 L0,16 Z" fill="url(#rev-flash-cone)" />
              <path d="M0,-12 L26,-56 L40,-90 L46,-38 L26,-14 Z" fill="url(#rev-flash-cone)" transform="rotate(-8)" opacity="0.9" />
              <path d="M0,12 L26,56 L40,90 L46,38 L26,14 Z" fill="url(#rev-flash-cone)" transform="rotate(8)" opacity="0.9" />
              <path d="M0,-6 L20,-30 L60,-40 L30,-10 Z" fill="url(#rev-flash-cone)" transform="rotate(-30)" opacity="0.7" />
              <path d="M0,6 L20,30 L60,40 L30,10 Z" fill="url(#rev-flash-cone)" transform="rotate(30)" opacity="0.7" />
              <path d="M6,-8 L36,-22 L86,-11 L106,0 L86,11 L36,22 L6,8 Z" fill="#fff8dc" opacity="0.9" />
              <circle r="26" fill="url(#rev-flash-core)" filter={F("rev-blur3")} />
              <circle r="12" fill="#fff" />
            </g>
          )}
        </g>

        {/* Дым после выстрела. */}
        {p.smoke > 0 && p.smoke < 1 && (
          <g filter={F("rev-blur6")}>
            {[0, 1, 2, 3, 4].map((i) => {
              const delay = i * 0.09;
              const k = Math.max(0, Math.min(1, (p.smoke - delay) / (1 - delay)));
              if (k <= 0) return null;
              const e = 1 - Math.pow(1 - k, 2);
              const cx = MUZZLE.x + 18 + e * (60 + i * 24) + gunDx * (1 - e);
              const cy = MUZZLE.y - e * (80 + i * 28) + Math.sin(k * 6 + i) * 6 + gunDy * (1 - e);
              const r = 10 + e * (34 + i * 9);
              return <circle key={i} cx={fmt(cx)} cy={fmt(cy)} r={fmt(r)} fill="#c9ced3" opacity={fmt((1 - k) * 0.42)} />;
            })}
            {[0, 1].map((i) => {
              const k = Math.max(0, Math.min(1, (p.smoke - 0.05 * i) / 0.9));
              if (k <= 0) return null;
              const e = 1 - Math.pow(1 - k, 2);
              return (
                <circle
                  key={`g${i}`}
                  cx={fmt(438 + e * 20 - i * 10)}
                  cy={fmt(190 - e * (60 + 20 * i))}
                  r={fmt(6 + e * 22)}
                  fill="#c9ced3"
                  opacity={fmt((1 - k) * 0.3)}
                />
              );
            })}
          </g>
        )}
      </g>

      {/* Кадровая вспышка всего экрана. */}
      {p.flash > 0 && <rect x="150" y="90" width="700" height="380" fill="#fff4d6" opacity={fmt(0.28 * p.flash * p.flash)} />}
    </svg>
  );
});

function CylinderFace({
  cartridges,
  drop,
}: {
  cartridges: CartridgeState[];
  drop: number[];
}) {
  return (
    <g>
      <circle r={CYL_R} fill="url(#rev-face)" stroke="#0f1215" strokeWidth="1.5" />
      <circle r={CYL_R - 5} fill="none" stroke="#e6ebef" strokeWidth="0.8" opacity="0.3" />
      {/* Проточки стопора между каморами. */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={`n${i}`}
          x="-3"
          y={-CYL_R + 1}
          width="6"
          height="7"
          rx="1"
          fill="#0f1317"
          transform={`rotate(${i * 60 + 30})`}
        />
      ))}
      {/* Каморы. */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = ((i * 60 - 90) * Math.PI) / 180;
        const cx = Math.cos(a) * CHAMBER_RING;
        const cy = Math.sin(a) * CHAMBER_RING;
        return (
          <g key={`c${i}`} className="revolver__chamber" data-chamber={i} data-cartridge={cartridges[i] ?? "empty"}>
            <circle cx={fmt(cx)} cy={fmt(cy)} r={CHAMBER_R + 1.5} fill="#1a1e23" opacity="0.8" />
            <circle cx={fmt(cx)} cy={fmt(cy)} r={CHAMBER_R} fill="url(#rev-bore)" stroke="#5a636c" strokeWidth="1" />
          </g>
        );
      })}
      {/* Звезда экстрактора. */}
      <path d={starPath(6, 22, 9)} fill="url(#rev-steel)" stroke="#0f1215" strokeWidth="1" transform="rotate(30)" />
      <circle r="7" fill="url(#rev-steel-dark)" stroke="#0f1215" strokeWidth="1" />
      <circle r="2.5" fill="#0a0c0e" />
      {/* Патроны: боевой или стреляная гильза. */}
      {cartridges.map((state, i) => {
        if (state === "empty") return null;
        const a = ((i * 60 - 90) * Math.PI) / 180;
        const cx = Math.cos(a) * CHAMBER_RING;
        const cy = Math.sin(a) * CHAMBER_RING;
        const e = easeOutCubicCartridge(drop[i] ?? 0);
        const dy = -150 * (1 - e);
        const sc = 1 + 0.6 * (1 - e);
        const op = Math.min(1, (drop[i] ?? 0) * 4);
        const spent = state === "spent";
        return (
          <g key={`b${i}`} transform={`translate(${fmt(cx)} ${fmt(cy + dy)}) scale(${fmt(sc)})`} opacity={fmt(op)}>
            <circle r={CHAMBER_R - 1.5} fill={spent ? "url(#rev-brass-spent)" : "url(#rev-brass)"} stroke={spent ? "#241305" : "#6b4a14"} strokeWidth="1" />
            {!spent && <circle r={CHAMBER_R - 5} fill="none" stroke="#7a5518" strokeWidth="0.8" opacity="0.8" />}
            <circle r="5" fill={spent ? "#160d06" : "url(#rev-primer)"} stroke={spent ? "#090502" : "#4d555d"} strokeWidth="0.8" />
            {spent && <path d="M-3.2 -3 L3.3 3.1 M3.1 -3.2 L-3.1 3.2" stroke="#090502" strokeWidth="1.15" opacity="0.9" />}
            {!spent && <circle cx="-4" cy="-4" r="2.2" fill="#fff" opacity="0.55" />}
          </g>
        );
      })}
    </g>
  );
}

function starPath(points: number, outer: number, inner: number) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += `${i === 0 ? "M" : "L"}${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)} `;
  }
  return d + "Z";
}
