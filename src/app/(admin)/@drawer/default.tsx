// The fallback for the Staff console's @drawer slot. On a hard load Next
// renders this for every console URL (the company drawer only exists as a
// soft-navigation intercept), and it renders nothing.
export default function ConsoleDrawerDefault() {
  return null;
}
