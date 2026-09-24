/* Sheet palettes: DATA, not chrome.
 *
 * Every hex value here is either written into stored table data (a cell's
 * "$fmt" text colour c and fill bg, a column's conditional rule bg, colour
 * scale and data-bar colours) or marks data on the grid (the find
 * highlight). A persisted style must look the same in every theme and in
 * every client that reads the row, including the public embed, so these can
 * never be CSS variables. Changing a value here does not rewrite any stored
 * row: old rows keep rendering the hex they were saved with, and the toolbar
 * simply stops offering the old swatch.
 *
 * Chrome colours live in tokens.css; nothing outside the sheet's cell
 * styling should import from this module.
 */

export type Swatch = { hex: string; name: string };

/** Toolbar text colours (Sheets' compact grid reduced to the brand YBRG plus
 *  neutrals). Saturated so text stays legible on white. */
export const TEXT_SWATCHES: Swatch[] = [
  { hex: "#000000", name: "Black" },
  { hex: "#5F6368", name: "Dark grey" },
  { hex: "#9AA0A6", name: "Grey" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#E2445C", name: "Red" },
  { hex: "#FF8A00", name: "Orange" },
  { hex: "#B58A00", name: "Dark yellow" },
  { hex: "#00A65B", name: "Green" },
  { hex: "#0073EA", name: "Blue" },
  { hex: "#0B3D91", name: "Navy" },
];

/** Toolbar fill colours: tints, so black text stays readable on top. */
export const FILL_SWATCHES: Swatch[] = [
  { hex: "#FFFFFF", name: "White" },
  { hex: "#F1F3F4", name: "Light grey" },
  { hex: "#D9DCE0", name: "Grey" },
  { hex: "#5F6368", name: "Dark grey" },
  { hex: "#FBD9DE", name: "Light red" },
  { hex: "#FFE4C2", name: "Light orange" },
  { hex: "#FFF2B3", name: "Light yellow" },
  { hex: "#CCF4E3", name: "Light green" },
  { hex: "#D6E8FF", name: "Light blue" },
  { hex: "#FFCB00", name: "Yellow" },
];

/** Conditional rule fills, cycled as rules are added. */
export const RULE_COLORS = ["#FBD9DE", "#FFE4C2", "#FFF2B3", "#CCF4E3", "#D6E8FF", "#E7DAF7"];

/** Colour scale and data bar defaults (the Sheets and Excel defaults). */
export const SCALE_DEFAULT = { min: "#F8696B", mid: "#FFEB84", max: "#63BE7B" };
export const BAR_DEFAULT = "#5B9BD5";

/** Find and replace highlight, Sheets' find green: every match tints light
 *  green, the current match paints the full swatch. */
export const FIND_CURRENT_BG = "#b7e1cd";
export const FIND_MATCH_BG = "rgba(183, 225, 205, 0.45)";
