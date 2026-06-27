import type { FC, ReactNode } from "react";

// Bespoke colorful app glyphs for the rail. Each is a flat multi-color mini
// illustration (no gradients) with a soft drop-shadow for depth. White shapes
// carry a faint outline so the glyph reads on both the dark rail and the
// near-white active pill. viewBox 0 0 24 24.

type P = { size?: number };

// Bright, dark-rail-friendly palette (all also read on white).
const B = "#2B8EF0";   // blue
const G = "#1FC77E";   // green
const R = "#FF5168";   // red
const Y = "#FFC400";   // yellow
const SL = "#8595AD";  // slate
const W = "#FFFFFF";
const INK = "#0B1324";
const OUT = "#CBD6E6";

function Svg({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.32))" }}>
      {children}
    </svg>
  );
}

const Home: FC<P> = ({ size }) => (
  <Svg size={size}>
    <path d="M12 3.6 L20.7 11.1 a1 1 0 0 1 -0.65 1.75 H3.95 A1 1 0 0 1 3.3 11.1 Z" fill={B} />
    <path d="M5.6 12 H18.4 V19.6 a1 1 0 0 1 -1 1 H6.6 a1 1 0 0 1 -1 -1 Z" fill={W} stroke={OUT} strokeWidth="0.8" />
    <rect x="10" y="14.4" width="4" height="6.2" rx="0.7" fill={Y} />
  </Svg>
);

const Calendar: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="3" y="5.5" width="18" height="15.5" rx="3.2" fill={W} stroke={OUT} strokeWidth="0.8" />
    <path d="M3 9.2a3.2 3.2 0 0 1 3.2-3.2h11.6A3.2 3.2 0 0 1 21 9.2v.6H3z" fill={R} />
    <rect x="7.3" y="3" width="2.1" height="4.4" rx="1.05" fill={INK} />
    <rect x="14.6" y="3" width="2.1" height="4.4" rx="1.05" fill={INK} />
    <rect x="6.4" y="12" width="3.1" height="3.1" rx="0.9" fill={B} />
    <rect x="10.9" y="12" width="3.1" height="3.1" rx="0.9" fill={Y} />
    <rect x="15.4" y="12" width="2.4" height="3.1" rx="0.9" fill={G} />
    <rect x="6.4" y="16.4" width="3.1" height="2.6" rx="0.9" fill={G} />
    <rect x="10.9" y="16.4" width="3.1" height="2.6" rx="0.9" fill={B} />
  </Svg>
);

const AI: FC<P> = ({ size }) => (
  <Svg size={size}>
    <path d="M11 3 C11.5 8.4 12.6 9.6 18 11 C12.6 12.4 11.5 13.6 11 19 C10.5 13.6 9.4 12.4 4 11 C9.4 9.6 10.5 8.4 11 3 Z" fill={Y} />
    <path d="M18 5 C18.2 6.9 18.5 7.2 20.4 7.6 C18.5 8 18.2 8.3 18 10.2 C17.8 8.3 17.5 8 15.6 7.6 C17.5 7.2 17.8 6.9 18 5 Z" fill={B} />
    <circle cx="17" cy="17" r="1.7" fill={R} />
  </Svg>
);

const Teams: FC<P> = ({ size }) => (
  <Svg size={size}>
    <circle cx="15.6" cy="9.8" r="2.7" fill={G} />
    <path d="M12.9 20 c0-2.6 1.9-4.3 4.6-4.3 s4.6 1.7 4.6 4.3 H12.9 Z" fill={W} stroke={OUT} strokeWidth="0.8" />
    <circle cx="8.5" cy="9" r="3.1" fill={B} />
    <path d="M3.4 20 c0-2.9 2.4-4.7 5.1-4.7 s5.1 1.8 5.1 4.7 H3.4 Z" fill={W} stroke={OUT} strokeWidth="0.8" />
  </Svg>
);

const Notes: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="5" y="3" width="14" height="18" rx="2.2" fill={W} stroke={OUT} strokeWidth="0.8" />
    <rect x="7.6" y="7" width="8.8" height="1.8" rx="0.9" fill={B} />
    <rect x="7.6" y="11" width="8.8" height="1.8" rx="0.9" fill={Y} />
    <rect x="7.6" y="15" width="5.6" height="1.8" rx="0.9" fill={G} />
  </Svg>
);

const Dashboards: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="2.4" fill={W} stroke={OUT} strokeWidth="0.8" />
    <rect x="6.4" y="12" width="2.7" height="4.6" rx="0.6" fill={B} />
    <rect x="10.65" y="9" width="2.7" height="7.6" rx="0.6" fill={G} />
    <rect x="14.9" y="7" width="2.7" height="9.6" rx="0.6" fill={Y} />
  </Svg>
);

const Library: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="4.4" y="4" width="3.6" height="16" rx="1" fill={B} />
    <rect x="8.5" y="6" width="3.6" height="14" rx="1" fill={R} />
    <rect x="12.6" y="4" width="3.6" height="16" rx="1" fill={G} />
    <rect x="16.7" y="6.5" width="3.3" height="13.5" rx="1" fill={Y} />
    <rect x="5" y="7" width="2.4" height="1" rx="0.5" fill={W} opacity="0.75" />
    <rect x="13.2" y="7" width="2.4" height="1" rx="0.5" fill={W} opacity="0.75" />
  </Svg>
);

const Forms: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="4.5" y="4.6" width="15" height="16.4" rx="2.2" fill={W} stroke={OUT} strokeWidth="0.8" />
    <rect x="8.5" y="2.7" width="7" height="3.4" rx="1.2" fill={SL} />
    <path d="M8 13.2 l2.4 2.4 l4.9 -5.1" stroke={G} strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="8" y="17.4" width="8" height="1.6" rx="0.8" fill={B} />
  </Svg>
);

const Clips: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="2.5" y="7" width="12.5" height="10" rx="2.2" fill={W} stroke={OUT} strokeWidth="0.8" />
    <path d="M15.5 10.3 L20.6 7.2 a0.6 0.6 0 0 1 0.9 0.52 V16.28 a0.6 0.6 0 0 1 -0.9 0.52 L15.5 13.7 Z" fill={B} />
    <circle cx="7" cy="12" r="2.1" fill={R} />
  </Svg>
);

const Goals: FC<P> = ({ size }) => (
  <Svg size={size}>
    <path d="M7 4 H17 V7.6 A5 5 0 0 1 7 7.6 Z" fill={Y} />
    <path d="M7.2 5.2 H4.6 a0.8 0.8 0 0 0 -0.8 0.8 C3.8 8.4 5.2 9.9 7.4 10" stroke={Y} strokeWidth="1.6" fill="none" />
    <path d="M16.8 5.2 H19.4 a0.8 0.8 0 0 1 0.8 0.8 C20.2 8.4 18.8 9.9 16.6 10" stroke={Y} strokeWidth="1.6" fill="none" />
    <rect x="11" y="11.8" width="2" height="3.4" fill={Y} />
    <rect x="8.6" y="14.9" width="6.8" height="2.4" rx="0.8" fill={B} />
    <rect x="7.4" y="18" width="9.2" height="2.5" rx="0.9" fill={B} />
    <circle cx="12" cy="6.6" r="1.6" fill={R} />
  </Svg>
);

const Timesheets: FC<P> = ({ size }) => (
  <Svg size={size}>
    <circle cx="12" cy="12.5" r="8.8" fill={W} stroke={OUT} strokeWidth="0.8" />
    <circle cx="12" cy="12.5" r="8.8" fill="none" stroke={B} strokeWidth="1.7" />
    <path d="M12 12.5 V7.6" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
    <path d="M12 12.5 L15.6 13.6" stroke={R} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="12.5" r="1.15" fill={INK} />
  </Svg>
);

const Sops: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.1" fill={W} stroke={OUT} strokeWidth="0.8" />
    <circle cx="8.6" cy="8" r="1.3" fill={G} />
    <rect x="11" y="7.2" width="5.6" height="1.6" rx="0.8" fill={B} />
    <circle cx="8.6" cy="12" r="1.3" fill={Y} />
    <rect x="11" y="11.2" width="5.6" height="1.6" rx="0.8" fill={SL} />
    <circle cx="8.6" cy="16" r="1.3" fill={R} />
    <rect x="11" y="15.2" width="4.4" height="1.6" rx="0.8" fill={SL} />
  </Svg>
);

const Trash: FC<P> = ({ size }) => (
  <Svg size={size}>
    <rect x="5.6" y="7.4" width="12.8" height="13.2" rx="2.2" fill={W} stroke={OUT} strokeWidth="0.8" />
    <rect x="3.8" y="4.9" width="16.4" height="2.9" rx="1.45" fill={R} />
    <rect x="9.5" y="2.8" width="5" height="2.7" rx="1" fill={R} />
    <rect x="9" y="10.6" width="1.6" height="7" rx="0.8" fill={SL} />
    <rect x="13.4" y="10.6" width="1.6" height="7" rx="0.8" fill={SL} />
  </Svg>
);

export const APP_GLYPHS: Record<string, FC<P>> = {
  home: Home,
  planner: Calendar,
  ai: AI,
  teams: Teams,
  docs: Notes,
  dashboards: Dashboards,
  library: Library,
  forms: Forms,
  clips: Clips,
  goals: Goals,
  timesheets: Timesheets,
  sops: Sops,
  trash: Trash,
};

export function hasAppGlyph(appKey: string): boolean {
  return appKey in APP_GLYPHS;
}

export function AppGlyph({ appKey, size = 18 }: { appKey: string; size?: number }) {
  const Comp = APP_GLYPHS[appKey];
  return Comp ? <Comp size={size} /> : null;
}
