// home.notifications.desktop as the desktop hook's three states. Pure; tested.

export type DesktopPref = "on" | "off" | "unset";

export function desktopPrefOf(value: boolean | null | undefined): DesktopPref {
  return value === true ? "on" : value === false ? "off" : "unset";
}
