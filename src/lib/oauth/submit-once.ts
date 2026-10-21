// The consent form sends once (review of step 1). A double click on Allow
// posted the decision twice: the first answer (the 303 carrying the code)
// was dropped by the browser for the second, which found the request taken
// and showed a refusal, so the code was stranded and the app never
// connected. This guard lets the first submit through and stops every one
// after it; the buttons are disabled a moment later, once the browser has
// already read the pressed button's value (a button disabled during its own
// submit event would be left out of the form).
//
// Pure: the consent page's client form (src/app/(auth)/oauth/submit-once-form.tsx)
// and the tests share it.

export interface SubmitEventLike {
  preventDefault(): void;
}

export function submitOnceGuard(disable: () => void, later: (fn: () => void) => void = (fn) => setTimeout(fn, 0)) {
  let sent = false;
  return {
    onSubmit(e: SubmitEventLike): void {
      if (sent) {
        e.preventDefault();
        return;
      }
      sent = true;
      later(disable);
    },
    get sent(): boolean {
      return sent;
    },
  };
}
