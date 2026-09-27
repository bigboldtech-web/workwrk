// The type glyph an asset row and its drawer carry (spec-tools-misc 2.2):
// Laptop, Monitor, Smartphone, Armchair, Car, IdCard, else Box. One map, so
// the register, the profile tab and the Trash row agree.

import {
  Armchair, Box, Car, Headphones, IdCard, Keyboard, Laptop, Monitor, Mouse, Smartphone, Tablet, Webcam, type LucideIcon,
} from "lucide-react";

const GLYPH: Record<string, LucideIcon> = {
  LAPTOP: Laptop,
  DESKTOP: Monitor,
  MONITOR: Monitor,
  PHONE: Smartphone,
  TABLET: Tablet,
  KEYBOARD: Keyboard,
  MOUSE: Mouse,
  HEADSET: Headphones,
  WEBCAM: Webcam,
  CHAIR: Armchair,
  DESK: Box,
  ID_CARD: IdCard,
  ACCESS_CARD: IdCard,
  VEHICLE: Car,
};

export function assetGlyph(type: string | null | undefined): LucideIcon {
  return (type && GLYPH[type]) || Box;
}
