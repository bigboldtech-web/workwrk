// The Staff console's 404, rendered inside the console frame (the (admin)
// layout): an unknown console path, and any notFound() thrown below /admin.
// A server file, like (dashboard)/not-found.tsx, with the client body in
// console-not-found.tsx.

import { ConsoleNotFoundView } from "../console-not-found";

export default function ConsoleNotFound() {
  return <ConsoleNotFoundView />;
}
