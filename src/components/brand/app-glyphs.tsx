import type { FC, ReactNode } from "react";

// Duotone app glyphs. Each icon is two tones of a single brand colour: a solid
// key shape plus a lighter tint fill. Flat (no shadow), 24px grid, consistent
// radii. The tint reads on the dark rail; the solid reads on the white active
// pill — so each glyph works on both without white fills.

type P = { size?: number };

// Per-hue [solid, tint] pairs.
const HUE = {
  blue: { s: "#2F8BF0", t: "#C3DDFA" },
  red: { s: "#FB5A6F", t: "#FFCDD4" },
  green: { s: "#1FB877", t: "#BFEBD8" },
  teal: { s: "#16A9A1", t: "#BAE8E5" },
  amber: { s: "#F2A93B", t: "#FBE4BC" },
  yellow: { s: "#E7AC08", t: "#FBE9AE" },
  pink: { s: "#EC4D9B", t: "#FBCBE3" },
  slate: { s: "#6B7A91", t: "#D3DBE6" },
} as const;

function Svg({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

const Home: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M4.7 11.4 V19 a1.1 1.1 0 0 0 1.1 1.1 H18.2 a1.1 1.1 0 0 0 1.1 -1.1 V11.4 L12 5 Z" fill={t} />
      <path d="M3 11.9 L12 4.3 L21 11.9" stroke={s} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.8 20.1 V15.4 a2.2 2.2 0 0 1 4.4 0 V20.1 Z" fill={s} />
    </Svg>
  );
};

const Calendar: FC<P> = ({ size }) => {
  const { s, t } = HUE.red;
  return (
    <Svg size={size}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" fill={t} />
      <path d="M3.5 9 a3 3 0 0 1 3 -3 H17.5 a3 3 0 0 1 3 3 H3.5 Z" fill={s} />
      <rect x="7" y="3.4" width="2" height="4.2" rx="1" fill={s} />
      <rect x="15" y="3.4" width="2" height="4.2" rx="1" fill={s} />
      <g fill={s}>
        <circle cx="8" cy="13" r="1.25" /><circle cx="12" cy="13" r="1.25" /><circle cx="16" cy="13" r="1.25" />
        <circle cx="8" cy="17" r="1.25" /><circle cx="12" cy="17" r="1.25" />
      </g>
    </Svg>
  );
};

const AI: FC<P> = ({ size }) => {
  const { s, t } = HUE.pink;
  return (
    <Svg size={size}>
      <path d="M11.5 3 C12 8 13.4 9.4 18.5 10 C13.4 10.6 12 12 11.5 17 C11 12 9.6 10.6 4.5 10 C9.6 9.4 11 8 11.5 3 Z" fill={t} />
      <path d="M17.6 13.5 C17.8 15.7 18.1 16 20.3 16.2 C18.1 16.4 17.8 16.7 17.6 18.9 C17.4 16.7 17.1 16.4 14.9 16.2 C17.1 16 17.4 15.7 17.6 13.5 Z" fill={s} />
    </Svg>
  );
};

const Teams: FC<P> = ({ size }) => {
  const { s, t } = HUE.green;
  return (
    <Svg size={size}>
      <circle cx="15.6" cy="9.6" r="2.6" fill={t} />
      <path d="M11.6 20 c0-2.7 2-4.4 4.4-4.4 s4.4 1.7 4.4 4.4 Z" fill={t} />
      <circle cx="8.8" cy="8.8" r="3" fill={s} />
      <path d="M3.4 20 c0-3 2.4-4.8 5.4-4.8 s5.4 1.8 5.4 4.8 Z" fill={s} />
    </Svg>
  );
};

const Notes: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.6" fill={t} />
      <g fill={s}>
        <rect x="8" y="7.4" width="8" height="1.8" rx="0.9" />
        <rect x="8" y="11" width="8" height="1.8" rx="0.9" />
        <rect x="8" y="14.6" width="5" height="1.8" rx="0.9" />
      </g>
    </Svg>
  );
};

const Dashboards: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" fill={t} />
      <g fill={s}>
        <rect x="6.6" y="11.5" width="2.6" height="4.5" rx="0.8" />
        <rect x="10.7" y="8.5" width="2.6" height="7.5" rx="0.8" />
        <rect x="14.8" y="6.5" width="2.6" height="9.5" rx="0.8" />
      </g>
    </Svg>
  );
};

const Library: FC<P> = ({ size }) => {
  const { s, t } = HUE.teal;
  return (
    <Svg size={size}>
      <rect x="4.5" y="4" width="3.7" height="16" rx="1.2" fill={s} />
      <rect x="8.55" y="4" width="3.7" height="16" rx="1.2" fill={t} />
      <rect x="12.6" y="4" width="3.7" height="16" rx="1.2" fill={s} />
      <rect x="16.5" y="6" width="3.3" height="14" rx="1.2" fill={t} />
    </Svg>
  );
};

const Forms: FC<P> = ({ size }) => {
  const { s, t } = HUE.green;
  return (
    <Svg size={size}>
      <rect x="4.5" y="4.6" width="15" height="16" rx="2.6" fill={t} />
      <rect x="8.5" y="2.8" width="7" height="3.2" rx="1.4" fill={s} />
      <path d="M8 12.6 l2.4 2.4 l4.9 -5.1" stroke={s} strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};

const Clips: FC<P> = ({ size }) => {
  const { s, t } = HUE.red;
  return (
    <Svg size={size}>
      <rect x="2.5" y="7" width="12.2" height="10" rx="2.6" fill={t} />
      <path d="M14.7 10.2 L20.6 7.2 a0.6 0.6 0 0 1 .9 .52 V16.28 a0.6 0.6 0 0 1 -.9 .52 L14.7 14 Z" fill={s} />
      <circle cx="7" cy="12" r="2.2" fill={s} />
    </Svg>
  );
};

const Goals: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <path d="M7 4.5 H17 V8 A5 5 0 0 1 7 8 Z" fill={t} />
      <path d="M7.2 5.6 H4.8 a0.8 .8 0 0 0 -.8 .8 C4 8.6 5.2 10 7.3 10.2" stroke={s} strokeWidth="1.7" fill="none" />
      <path d="M16.8 5.6 H19.2 a0.8 .8 0 0 1 .8 .8 C20 8.6 18.8 10 16.7 10.2" stroke={s} strokeWidth="1.7" fill="none" />
      <rect x="11" y="11.8" width="2" height="3.4" fill={s} />
      <rect x="8" y="14.9" width="8" height="2.4" rx="0.9" fill={s} />
      <rect x="7" y="18" width="10" height="2.5" rx="1" fill={s} />
    </Svg>
  );
};

const Timesheets: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <circle cx="12" cy="12.5" r="8.5" fill={t} />
      <circle cx="12" cy="12.5" r="8.5" fill="none" stroke={s} strokeWidth="1.8" />
      <path d="M12 12.5 V7.8" stroke={s} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12.5 L15.4 13.6" stroke={s} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12.5" r="1.15" fill={s} />
    </Svg>
  );
};

const Sops: FC<P> = ({ size }) => {
  const { s, t } = HUE.teal;
  return (
    <Svg size={size}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.4" fill={t} />
      <g fill={s}>
        <circle cx="8.6" cy="8" r="1.3" /><rect x="11" y="7.2" width="5.5" height="1.6" rx="0.8" />
        <circle cx="8.6" cy="12" r="1.3" /><rect x="11" y="11.2" width="5.5" height="1.6" rx="0.8" />
        <circle cx="8.6" cy="16" r="1.3" /><rect x="11" y="15.2" width="4" height="1.6" rx="0.8" />
      </g>
    </Svg>
  );
};

const Trash: FC<P> = ({ size }) => {
  const { s, t } = HUE.slate;
  return (
    <Svg size={size}>
      <rect x="5.5" y="7.5" width="13" height="13" rx="2.4" fill={t} />
      <rect x="3.8" y="5" width="16.4" height="2.9" rx="1.45" fill={s} />
      <rect x="9.5" y="2.8" width="5" height="2.6" rx="1" fill={s} />
      <g fill={s}><rect x="9" y="10.6" width="1.6" height="7" rx="0.8" /><rect x="13.4" y="10.6" width="1.6" height="7" rx="0.8" /></g>
    </Svg>
  );
};

const Recruiting: FC<P> = ({ size }) => {
  const { s, t } = HUE.green;
  return (
    <Svg size={size}>
      <circle cx="9.5" cy="8" r="3.1" fill={t} />
      <path d="M3.6 20 c0-3.1 2.6-4.9 5.9-4.9 1.3 0 2.5 .3 3.5 .8 H3.6 Z" fill={t} />
      <circle cx="16.6" cy="16" r="4.3" fill={s} />
      <path d="M16.6 13.7 V18.3 M14.3 16 H18.9" stroke={t} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
};

const Onboarding: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <rect x="8.5" y="3.5" width="10" height="17" rx="2" fill={t} />
      <rect x="8.5" y="3.5" width="10" height="17" rx="2" fill="none" stroke={s} strokeWidth="1.8" />
      <circle cx="15.3" cy="12" r="1" fill={s} />
      <path d="M2.6 12 H7.2 M4.8 9.7 L7.4 12 L4.8 14.3" stroke={s} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};

const Reviews: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <rect x="4" y="4" width="16" height="16" rx="2.6" fill={t} />
      <path d="M12 7 l1.6 3.5 l3.8 .4 l-2.9 2.6 l.9 3.7 l-3.4 -2 l-3.4 2 l.9 -3.7 l-2.9 -2.6 l3.8 -.4 Z" fill={s} />
    </Svg>
  );
};

const Candor: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M3 7.5 a2 2 0 0 1 2 -2 H12 a2 2 0 0 1 2 2 V11 a2 2 0 0 1 -2 2 H7.5 L5 15.3 V13 a2 2 0 0 1 -2 -2 Z" fill={s} />
      <path d="M10 11.5 a2 2 0 0 1 2 -2 H19 a2 2 0 0 1 2 2 V15 a2 2 0 0 1 -2 2 V19.3 L16.5 17 H12 a2 2 0 0 1 -2 -2 Z" fill={t} />
    </Svg>
  );
};

const Announcements: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <path d="M3.5 10.5 L13 6.5 V17.5 L3.5 13.5 Z" fill={t} />
      <rect x="12" y="8" width="2.8" height="8" rx="1.4" fill={s} />
      <path d="M5 13.5 V16.5 a1.6 1.6 0 0 0 3.2 0 V14.8" fill={s} />
      <path d="M16.5 9 a4.5 4.5 0 0 1 0 6 M18.5 7 a7.5 7.5 0 0 1 0 10" stroke={s} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </Svg>
  );
};

const Kudos: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <path d="M8.5 3 L11.5 8.5 H6.5 Z" fill={s} />
      <path d="M15.5 3 L17.5 8.5 H12.5 Z" fill={s} />
      <circle cx="12" cy="14.5" r="5.7" fill={t} />
      <path d="M12 11.3 l1 2.1 l2.3 .2 l-1.7 1.5 l.5 2.2 l-2.1 -1.2 l-2.1 1.2 l.5 -2.2 l-1.7 -1.5 l2.3 -.2 Z" fill={s} />
    </Svg>
  );
};

const Surveys: FC<P> = ({ size }) => {
  const { s, t } = HUE.teal;
  return (
    <Svg size={size}>
      <rect x="4" y="4" width="16" height="16" rx="2.6" fill={t} />
      <g fill={s}>
        <rect x="7" y="7.5" width="10" height="2.3" rx="1.15" />
        <rect x="7" y="11" width="7" height="2.3" rx="1.15" />
        <rect x="7" y="14.5" width="9" height="2.3" rx="1.15" />
      </g>
    </Svg>
  );
};

const TimeOff: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <circle cx="12" cy="9.5" r="6.4" fill={t} />
      <circle cx="12" cy="9.5" r="3.6" fill={s} />
      <g stroke={s} strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2.6 V4.2" /><path d="M5.1 9.5 H6.7" /><path d="M17.3 9.5 H18.9" />
        <path d="M7 4.5 L8.1 5.6" /><path d="M15.9 5.6 L17 4.5" />
      </g>
      <path d="M3 18.6 q3 -2.3 6 0 t6 0 t6 0" stroke={s} strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </Svg>
  );
};

const Tools: FC<P> = ({ size }) => {
  const { s, t } = HUE.slate;
  return (
    <Svg size={size}>
      <path d="M16.8 3.6 a3.7 3.7 0 0 0 -4.8 4.8 l-7.3 7.3 a1.9 1.9 0 1 0 2.7 2.7 l7.3 -7.3 a3.7 3.7 0 0 0 4.8 -4.8 l-2.4 2.4 l-2.3 -.6 l-.6 -2.3 Z" fill={t} />
      <path d="M12 8.4 a3.7 3.7 0 0 0 4.8 -4.8 l-2.4 2.4 l-2.3 -.6 l-.6 -2.3 a3.7 3.7 0 0 0 -1.3 1.5" fill={s} />
      <circle cx="6.3" cy="17.7" r="1" fill={s} />
    </Svg>
  );
};

const Assets: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <path d="M12 3.8 L20 7.8 L12 11.8 L4 7.8 Z" fill={s} />
      <path d="M4 7.8 L12 11.8 V20 L4 16 Z" fill={t} />
      <path d="M20 7.8 L12 11.8 V20 L20 16 Z" fill={t} />
    </Svg>
  );
};

const Policies: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M12 3 L19 5.6 V11 c0 5 -3.4 8.2 -7 9.6 C8.4 19.2 5 16 5 11 V5.6 Z" fill={t} />
      <path d="M8.7 11.9 l2.3 2.3 l4.2 -4.5" stroke={s} strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};

const Agreements: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <rect x="5" y="3" width="13" height="18" rx="2.2" fill={t} />
      <g fill={s}>
        <rect x="7.6" y="7" width="7.8" height="1.6" rx="0.8" />
        <rect x="7.6" y="10.4" width="7.8" height="1.6" rx="0.8" />
        <rect x="7.6" y="13.8" width="4.5" height="1.6" rx="0.8" />
      </g>
      <path d="M16.4 13.2 l3.4 3.4 l-4.6 4.6 l-3.4 0 l0 -3.4 Z" fill={s} />
    </Svg>
  );
};

const Learning: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M7 11 V14.8 C7 16.4 9.2 17.4 12 17.4 S17 16.4 17 14.8 V11" fill={t} />
      <path d="M12 5 L22 9 L12 13 L2 9 Z" fill={s} />
      <path d="M21.5 9.2 V13.7" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="21.5" cy="14.2" r="1.1" fill={s} />
    </Svg>
  );
};

const Build: FC<P> = ({ size }) => {
  const { s, t } = HUE.green;
  return (
    <Svg size={size}>
      <rect x="6.5" y="14.5" width="11" height="5.2" rx="1.2" fill={s} />
      <rect x="8.2" y="9.3" width="7.6" height="5.2" rx="1.2" fill={t} />
      <rect x="9.8" y="4.1" width="4.4" height="5.2" rx="1.2" fill={s} />
    </Svg>
  );
};

const Store: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M4 8.5 L5.6 4.5 H18.4 L20 8.5 Z" fill={s} />
      <rect x="5" y="8.5" width="14" height="11" rx="1.4" fill={t} />
      <rect x="10" y="12.6" width="4" height="7" rx="0.6" fill={s} />
    </Svg>
  );
};

const Settings: FC<P> = ({ size }) => {
  const { s, t } = HUE.slate;
  return (
    <Svg size={size}>
      <path d="M12 2.6 l1.5 1 1.8 .25 1.8 -.55 1.35 1.35 -.55 1.8 .25 1.8 1 1.5 0 2 -1 1.5 -.25 1.8 .55 1.8 -1.35 1.35 -1.8 -.55 -1.8 .25 -1.5 1 -2 0 -1.5 -1 -1.8 -.25 -1.8 .55 -1.35 -1.35 .55 -1.8 -.25 -1.8 -1 -1.5 0 -2 1 -1.5 .25 -1.8 -.55 -1.8 1.35 -1.35 1.8 .55 1.8 -.25 1.5 -1 z" fill={t} />
      <circle cx="12" cy="12" r="3.2" fill={s} />
      <circle cx="12" cy="12" r="1.5" fill={t} />
    </Svg>
  );
};

export const APP_GLYPHS: Record<string, FC<P>> = {
  home: Home, planner: Calendar, ai: AI, teams: Teams, docs: Notes,
  dashboards: Dashboards, library: Library, forms: Forms, clips: Clips,
  goals: Goals, timesheets: Timesheets, sops: Sops, trash: Trash,
  recruiting: Recruiting, onboarding: Onboarding, reviews: Reviews,
  candor: Candor, announcements: Announcements, kudos: Kudos, surveys: Surveys,
  "time-off": TimeOff, tools: Tools, assets: Assets, policies: Policies,
  agreements: Agreements, learning: Learning, build: Build, store: Store,
  settings: Settings,
};

export function hasAppGlyph(appKey: string): boolean {
  return appKey in APP_GLYPHS;
}

export function AppGlyph({ appKey, size = 18 }: { appKey: string; size?: number }) {
  const Comp = APP_GLYPHS[appKey];
  return Comp ? <Comp size={size} /> : null;
}

/* ── Quick-tool glyphs (topbar right cluster) ── */

const CreateTask: FC<P> = ({ size }) => {
  const { s, t } = HUE.green;
  return (
    <Svg size={size}>
      <rect x="4" y="4" width="16" height="16" rx="3.6" fill={t} />
      <path d="M8 12 l2.6 2.6 l5.3 -5.7" stroke={s} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
};

const MyWork: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M8.5 7.5 V6.2 a1.7 1.7 0 0 1 1.7 -1.7 H13.8 a1.7 1.7 0 0 1 1.7 1.7 V7.5" fill="none" stroke={s} strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="7.5" width="18" height="12" rx="2.4" fill={t} />
      <rect x="3" y="11.2" width="18" height="2.3" fill={s} />
      <rect x="10.4" y="10.8" width="3.2" height="3" rx="0.7" fill={s} />
    </Svg>
  );
};

const Reminder: FC<P> = ({ size }) => {
  const { s, t } = HUE.red;
  return (
    <Svg size={size}>
      <path d="M4.6 6.2 L7.6 8.6 M19.4 6.2 L16.4 8.6" stroke={s} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="13.2" r="7" fill={t} />
      <circle cx="12" cy="13.2" r="7" fill="none" stroke={s} strokeWidth="1.7" />
      <path d="M12 13.2 V9.2" stroke={s} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 13.2 L15 14.7" stroke={s} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
};

const Notepad: FC<P> = ({ size }) => {
  const { s, t } = HUE.amber;
  return (
    <Svg size={size}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.2" fill={t} />
      <rect x="8" y="2.6" width="1.7" height="4" rx="0.85" fill={s} />
      <rect x="14.4" y="2.6" width="1.7" height="4" rx="0.85" fill={s} />
      <g fill={s}>
        <rect x="7.5" y="9.5" width="9" height="1.6" rx="0.8" />
        <rect x="7.5" y="13" width="9" height="1.6" rx="0.8" />
        <rect x="7.5" y="16.5" width="6" height="1.6" rx="0.8" />
      </g>
    </Svg>
  );
};

const Whiteboard: FC<P> = ({ size }) => {
  const { s, t } = HUE.teal;
  return (
    <Svg size={size}>
      <rect x="3" y="4.5" width="18" height="12" rx="2.2" fill={t} />
      <path d="M6.5 12.5 q2 -4.5 4 -1.5 t4 -1.5" stroke={s} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <path d="M12 16.5 V20" stroke={s} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
};

const InboxTray: FC<P> = ({ size }) => {
  const { s, t } = HUE.blue;
  return (
    <Svg size={size}>
      <path d="M4 6 a1.4 1.4 0 0 1 1.4 -1.4 H16.6 A1.4 1.4 0 0 1 18 6 V14 H4 Z" fill={t} />
      <path d="M3.2 13.5 H8 l1.5 2.3 h5 L16 13.5 H20.8 V16.6 a2 2 0 0 1 -2 2 H5.2 a2 2 0 0 1 -2 -2 Z" fill={s} />
    </Svg>
  );
};

export const TOOL_GLYPHS: Record<string, FC<P>> = {
  "create-task": CreateTask,
  "my-work": MyWork,
  "track-time": Timesheets,
  "notepad": Notepad,
  "record-clip": Clips,
  "create-reminder": Reminder,
  "create-doc": Notes,
  "create-whiteboard": Whiteboard,
  "view-people": Teams,
  "create-dashboard": Dashboards,
  "ai-notetaker": AI,
  "inbox": InboxTray,
};

export function hasToolGlyph(key: string): boolean {
  return key in TOOL_GLYPHS;
}

export function ToolGlyph({ toolKey, size = 18 }: { toolKey: string; size?: number }) {
  const Comp = TOOL_GLYPHS[toolKey];
  return Comp ? <Comp size={size} /> : null;
}
