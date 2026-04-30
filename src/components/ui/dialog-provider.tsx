"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { PromptDialog } from "./prompt-dialog";

/**
 * Imperative replacements for `window.confirm` / `window.prompt`,
 * styled to match the rest of the WorkwrK design system.
 *
 * Usage:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete folder?", description: "..." })) {
 *     // user clicked Confirm
 *   }
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: "Rename folder", defaultValue: f.name });
 *   if (name) // ...
 */

interface ConfirmOpts {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOpts {
  title?: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  required?: boolean;
}

interface DialogCtx {
  confirm: (opts?: ConfirmOpts) => Promise<boolean>;
  prompt: (opts?: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<DialogCtx | null>(null);

interface ConfirmState extends ConfirmOpts {
  resolve: (v: boolean) => void;
}
interface PromptState extends PromptOpts {
  resolve: (v: string | null) => void;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);

  const confirm = useCallback((opts: ConfirmOpts = {}) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOpts = {}) => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...opts, resolve });
    });
  }, []);

  function closeConfirm(value: boolean) {
    confirmState?.resolve(value);
    setConfirmState(null);
  }
  function closePrompt(value: string | null) {
    promptState?.resolve(value);
    setPromptState(null);
  }

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {confirmState && (
        <ConfirmDialog
          open
          onClose={() => closeConfirm(false)}
          onConfirm={() => closeConfirm(true)}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          destructive={confirmState.destructive}
        />
      )}
      {promptState && (
        <PromptDialog
          open
          onClose={() => closePrompt(null)}
          onSubmit={(v) => closePrompt(v)}
          title={promptState.title}
          description={promptState.description}
          defaultValue={promptState.defaultValue}
          placeholder={promptState.placeholder}
          submitLabel={promptState.submitLabel}
          cancelLabel={promptState.cancelLabel}
          required={promptState.required}
        />
      )}
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used inside <DialogProvider>");
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrompt must be used inside <DialogProvider>");
  return ctx.prompt;
}
