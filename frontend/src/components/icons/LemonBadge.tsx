import { useId } from "react";
import { cn } from "@/lib/utils";

export function LemonBadge({ className }: { className?: string }) {
    const uniqueId = useId();
    const bodyGradientId = `lemon-body-${uniqueId}`;
    const highlightGradientId = `lemon-highlight-${uniqueId}`;
    const leafGradientId = `lemon-leaf-${uniqueId}`;
    const clipPathId = `lemon-clip-${uniqueId}`;

    // Prolate spheroid / ellipsoid lemon shape - elongated oval
    // Oriented so left side is elevated, right side points down-right
    const lemonBodyPath =
        "M25 50 C25 38 32 28 45 24 C58 20 75 22 88 30 C101 38 110 50 110 58 C110 66 103 74 90 78 C77 82 60 80 47 72 C34 64 25 58 25 50 Z";

    return (
        <svg
            viewBox="-20 0 150 100"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
            className={cn("pointer-events-none select-none", className)}
        >
            <defs>
                <linearGradient id={bodyGradientId} x1="20" y1="30" x2="115" y2="75" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#FFFDEB" />
                    <stop offset="0.2" stopColor="#FFF176" />
                    <stop offset="0.6" stopColor="#FDE047" />
                    <stop offset="1" stopColor="#FACC15" />
                </linearGradient>

                <radialGradient
                    id={highlightGradientId}
                    cx="0"
                    cy="0"
                    r="1"
                    gradientUnits="userSpaceOnUse"
                    gradientTransform="translate(50 40) rotate(45) scale(35 25)"
                >
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
                    <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.3" />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                </radialGradient>

                <linearGradient id={leafGradientId} x1="10" y1="25" x2="40" y2="50" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#4ADE80" />
                    <stop offset="1" stopColor="#16A34A" />
                </linearGradient>

                <clipPath id={clipPathId}>
                    <path d={lemonBodyPath} />
                </clipPath>
            </defs>

            {/* Group rotated so left is elevated, right points down-right */}
            <g transform="rotate(0 65 50)">
                {/* Single leaf - rotated 45 degrees clockwise around its right tip */}
                <ellipse
                    cx="14"
                    cy="35"
                    rx="18"
                    ry="7"
                    transform="rotate(45 32 35)"
                    fill={`url(#${leafGradientId})`}
                    stroke="#166534"
                    strokeOpacity="0.4"
                    strokeWidth="0.8"
                />
                {/* Leaf vein */}
                <path
                    d="M5 22 C12 26 22 32 32 35"
                    stroke="#166534"
                    strokeOpacity="0.35"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                    fill="none"
                />

                {/* Stem connecting leaf to body */}
                <path
                    d="M32 35 C36 40 40 46 45 50"
                    stroke="#92400E"
                    strokeOpacity="0.7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                />

                {/* Lemon body - elongated prolate spheroid */}
                <path
                    d={lemonBodyPath}
                    fill={`url(#${bodyGradientId})`}
                    stroke="#EAB308"
                    strokeOpacity="0.25"
                    strokeWidth="1"
                />

                {/* Highlight sheen */}
                <g clipPath={`url(#${clipPathId})`}>
                    <ellipse
                        cx="55"
                        cy="42"
                        rx="28"
                        ry="16"
                        transform="rotate(-15 55 42)"
                        fill={`url(#${highlightGradientId})`}
                    />

                    {/* Texture dots - lemon peel bumps */}
                    <g opacity="0.2" fill="#EAB308">
                        <circle cx="45" cy="40" r="1" />
                        <circle cx="55" cy="35" r="0.8" />
                        <circle cx="65" cy="42" r="0.9" />
                        <circle cx="75" cy="50" r="0.8" />
                        <circle cx="85" cy="55" r="1" />
                        <circle cx="60" cy="55" r="0.9" />
                        <circle cx="50" cy="58" r="0.8" />
                        <circle cx="70" cy="62" r="0.9" />
                        <circle cx="80" cy="68" r="0.8" />
                        <circle cx="95" cy="60" r="0.9" />
                        <circle cx="40" cy="52" r="0.8" />
                        <circle cx="55" cy="68" r="0.9" />
                    </g>
                </g>
            </g>
        </svg>
    );
}
