import type { CSSProperties } from "react";
import "./dots-loader.css";

// WorkwrK four-dot brand loader (YBRG). The dots bounce in a row, converge
// and orbit as a circle, then expand back, on a loop. Use anywhere a spinner
// or "Loading..." would otherwise go.
//
//   <DotsLoader />                         inline animation
//   <DotsLoader label="Loading workspace" />   animation + caption
//   <DotsLoaderScreen label="Loading workspace" />  full-screen centered

export function DotsLoader({
  size = 40,
  label,
  className,
  style,
}: {
  /** Pixel size of the square animation stage. */
  size?: number;
  /** Optional caption rendered below the dots. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const vars = {
    "--wwk-dot": `${(size * 0.22).toFixed(2)}px`,
    "--wwk-gap": `${(size * 0.16).toFixed(2)}px`,
    "--wwk-jump": `${(size * 0.28).toFixed(2)}px`,
  } as CSSProperties;
  return (
    <span className={`wwk-dots${className ? ` ${className}` : ""}`} role="status" aria-label={label ?? "Loading"} style={style}>
      <span className="wwk-dots__row" style={vars}>
        <span className="wwk-dots__pip" />
        <span className="wwk-dots__pip" />
        <span className="wwk-dots__pip" />
        <span className="wwk-dots__pip" />
      </span>
      {label ? <span className="wwk-dots__label">{label}</span> : null}
    </span>
  );
}

// Full-screen centered loader for route/shell loading states.
export function DotsLoaderScreen({
  label = "Loading workspace",
  background = "#FFFFFF",
  size = 44,
}: {
  label?: string;
  background?: string;
  size?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background }}>
      <DotsLoader size={size} label={label} />
    </div>
  );
}
