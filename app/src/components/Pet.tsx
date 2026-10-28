import { useId } from "react";
import type { Mood } from "../lib/types";

interface PetProps {
  mood: Mood;
  size?: number;
  compact?: boolean;
  gaze?: { x: number; y: number };
  onPoke?: () => void;
  className?: string;
}

/**
 * MAX, drawn entirely in code — no sprite sheets, so every expression is honest
 * and the pet stays razor sharp at any size.
 */
export function Pet({ mood, size = 140, compact = false, gaze = { x: 0, y: 0 }, onPoke, className = "" }: PetProps) {
  const uid = useId().replace(/[:]/g, "");
  const bodyId = `body-${uid}`;
  const visorId = `visor-${uid}`;
  const eyeId = `eye-${uid}`;
  const antennaId = `antenna-${uid}`;
  const glowId = `glow-${uid}`;

  const eyeShift = { x: gaze.x * 3.6, y: gaze.y * 2.8 };
  const blinking = mood === "idle" || mood === "listening" || mood === "thinking";
  const arcEyes = mood === "happy" || mood === "celebrate";
  const closedEyes = mood === "sleepy";
  const squintEyes = mood === "working" || mood === "error";

  return (
    <svg
      className={`pet ${compact ? "pet--compact" : ""} ${className}`}
      data-mood={mood}
      width={size}
      height={size}
      viewBox={compact ? "34 50 132 108" : "0 0 200 200"}
      role="img"
      aria-label={`MAX is ${mood}`}
      onPointerDown={onPoke}
    >
      <defs>
        <radialGradient id={bodyId} cx="38%" cy="26%" r="82%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="52%" stopColor="#F1FAFF" />
          <stop offset="100%" stopColor="#CFE4F4" />
        </radialGradient>
        <linearGradient id={visorId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0E2438" />
          <stop offset="55%" stopColor="#0A1A2B" />
          <stop offset="100%" stopColor="#061220" />
        </linearGradient>
        <radialGradient id={eyeId} cx="42%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#F2FEFF" />
          <stop offset="45%" stopColor="#9DEEFF" />
          <stop offset="100%" stopColor="#31C4EA" />
        </radialGradient>
        <radialGradient id={antennaId} cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor="#9DEBFF" />
          <stop offset="100%" stopColor="#48C8EE" />
        </radialGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="pet__rig">
        <ellipse className="pet__shadow" cx="100" cy="188" rx="44" ry="7" />

        {/* antenna */}
        <g className="pet__antenna">
          <circle className="pet__antenna-halo" cx="106" cy="26" r="15" />
          <path className="pet__stalk" d="M100 64 C 100 46, 102 36, 105 31" />
          <circle className="pet__orb" cx="106" cy="26" r="7.5" fill={`url(#${antennaId})`} filter={`url(#${glowId})`} />
          <circle className="pet__orb-spark" cx="103.4" cy="23.4" r="2.1" />
        </g>

        {/* ears */}
        <g className="pet__ears">
          <ellipse className="pet__ear" cx="54" cy="64" rx="18" ry="17" fill={`url(#${bodyId})`} />
          <ellipse className="pet__ear-inner" cx="54" cy="65" rx="10" ry="9.5" />
          <ellipse className="pet__ear" cx="146" cy="64" rx="18" ry="17" fill={`url(#${bodyId})`} />
          <ellipse className="pet__ear-inner" cx="146" cy="65" rx="10" ry="9.5" />
        </g>

        {/* body */}
        <g className="pet__body">
          <ellipse className="pet__body-shape" cx="100" cy="118" rx="62" ry="60" fill={`url(#${bodyId})`} />
          <ellipse className="pet__belly" cx="100" cy="132" rx="43" ry="38" />
          <path className="pet__sheen" d="M52 96 C 58 62, 96 52, 128 58" />

          {/* visor */}
          <rect x="40" y="70" width="120" height="78" rx="39" fill={`url(#${visorId})`} />
          <rect className="pet__visor-rim" x="40" y="70" width="120" height="78" rx="39" />
          <ellipse className="pet__visor-sheen" cx="100" cy="88" rx="44" ry="10" />
          <rect className="pet__scanline" x="44" y="92" width="112" height="9" rx="4.5" />

          {/* eyes */}
          <g className={`pet__eyes ${blinking ? "pet__eyes--blink" : ""}`}>
            {arcEyes ? (
              <>
                <path className="pet__eye-arc" d="M62 110 C 69 92, 87 92, 94 110" />
                <path className="pet__eye-arc" d="M106 110 C 113 92, 131 92, 138 110" />
              </>
            ) : closedEyes ? (
              <>
                <path className="pet__eye-closed" d="M61 102 C 69 110, 85 110, 93 102" />
                <path className="pet__eye-closed" d="M107 102 C 115 110, 131 110, 139 102" />
              </>
            ) : (
              <>
                <g className="pet__pupils" style={{ transform: `translate(${eyeShift.x}px, ${eyeShift.y}px)` }}>
                  <ellipse
                    className="pet__eye"
                    cx="76"
                    cy={squintEyes ? 108 : 104}
                    rx={mood === "listening" ? 13.5 : 12.5}
                    ry={squintEyes ? 7.5 : mood === "listening" ? 17.5 : 16}
                    fill={`url(#${eyeId})`}
                  />
                  <ellipse
                    className="pet__eye"
                    cx="124"
                    cy={squintEyes ? 108 : 104}
                    rx={mood === "listening" ? 13.5 : 12.5}
                    ry={squintEyes ? 7.5 : mood === "listening" ? 17.5 : 16}
                    fill={`url(#${eyeId})`}
                  />
                  <ellipse className="pet__eye-spark" cx="71.5" cy="97" rx="3.6" ry="4.2" />
                  <ellipse className="pet__eye-spark" cx="119.5" cy="97" rx="3.6" ry="4.2" />
                </g>
                {mood === "error" && (
                  <>
                    <path className="pet__brow" d="M62 86 L 88 90" />
                    <path className="pet__brow" d="M138 86 L 112 90" />
                  </>
                )}
                {squintEyes && mood === "working" && (
                  <>
                    <path className="pet__lid" d="M63 99 L 89 99" />
                    <path className="pet__lid" d="M111 99 L 137 99" />
                  </>
                )}
              </>
            )}
          </g>

          {/* cheeks */}
          <ellipse className="pet__cheek" cx="58" cy="132" rx="7.5" ry="4" />
          <ellipse className="pet__cheek" cx="142" cy="132" rx="7.5" ry="4" />

          {/* mouth */}
          {mood === "happy" || mood === "celebrate" ? (
            <path className="pet__mouth pet__mouth--open" d="M91 132 C 95 143, 105 143, 109 132 Z" />
          ) : mood === "sleepy" ? (
            <path className="pet__mouth" d="M94 134 C 97 138, 103 138, 106 134" />
          ) : mood === "error" ? (
            <path className="pet__mouth" d="M92 138 C 96 133, 100 138, 104 133 C 106 131, 108 132, 109 134" />
          ) : mood === "thinking" ? (
            <ellipse className="pet__mouth" cx="100" cy="135" rx="4.6" ry="3.2" />
          ) : (
            <path className="pet__mouth" d="M92 133 C 96 138, 104 138, 108 133" />
          )}

          <g className="pet__badge">
            <rect x="87" y="160" width="26" height="9" rx="4.5" />
            <text x="100" y="166.6" textAnchor="middle">
              MAX
            </text>
          </g>
        </g>

        {/* arms + feet */}
        <g className="pet__arms">
          <ellipse className="pet__arm" cx="40" cy="140" rx="13" ry="9" transform="rotate(-18 40 140)" />
          <ellipse className="pet__arm" cx="160" cy="140" rx="13" ry="9" transform="rotate(18 160 140)" />
        </g>
        <g className="pet__legs">
          <ellipse className="pet__foot" cx="78" cy="176" rx="15" ry="9" />
          <ellipse className="pet__foot" cx="122" cy="176" rx="15" ry="9" />
        </g>

        {/* mood extras */}
        {mood === "sleepy" && (
          <g className="pet__zzz">
            <text x="146" y="46">z</text>
            <text x="158" y="34">z</text>
            <text x="170" y="24">z</text>
          </g>
        )}
        {mood === "thinking" && (
          <g className="pet__thinking">
            <circle cx="152" cy="62" r="2.6" />
            <circle cx="161" cy="54" r="3.4" />
            <circle cx="171" cy="44" r="4.2" />
          </g>
        )}
        {(mood === "celebrate" || mood === "happy") && (
          <g className="pet__sparkles">
            <path d="M40 60 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4z" />
            <path d="M166 92 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8z" />
            <path d="M52 120 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" />
          </g>
        )}
        {mood === "celebrate" && (
          <g className="pet__confetti">
            <rect x="34" y="76" width="5" height="2.6" rx="1.3" transform="rotate(24 34 76)" />
            <rect x="160" y="70" width="5" height="2.6" rx="1.3" transform="rotate(-32 160 70)" />
            <rect x="148" y="150" width="5" height="2.6" rx="1.3" transform="rotate(48 148 150)" />
            <rect x="46" y="152" width="5" height="2.6" rx="1.3" transform="rotate(-12 46 152)" />
            <circle cx="70" cy="46" r="2.4" />
            <circle cx="132" cy="42" r="2" />
          </g>
        )}
        {mood === "listening" && (
          <g className="pet__rings">
            <circle cx="100" cy="110" r="72" />
            <circle cx="100" cy="110" r="72" />
          </g>
        )}
        {mood === "error" && (
          <g className="pet__sweat">
            <path d="M30 78 C 26 87, 32 93, 38 90 C 42 87, 36 80, 30 78 Z" />
          </g>
        )}
        {mood === "working" && (
          <g className="pet__progress">
            <circle cx="100" cy="110" r="70" />
          </g>
        )}
      </g>
    </svg>
  );
}
