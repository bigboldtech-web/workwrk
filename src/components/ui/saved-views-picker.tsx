"use client";

// Saved views picker — drop-in UI for any list page that wants quick
// access to user-saved filter / sort presets. Pairs with `useSavedViews`.
//
// Render alongside the page filter bar:
//   <SavedViewsPicker
//     scope="people"
//     currentState={{ dept, status, sort }}
//     onLoad={(state) => { setDept(state.dept); ... }}
//   />

import { useState } from "react";
import { Bookmark, Check, Plus, Trash2, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSavedViews } from "@/hooks/use-saved-views";

export function SavedViewsPicker<T>({
  scope,
  currentState,
  onLoad,
}: {
  scope: string;
  currentState: T;
  onLoad: (state: T) => void;
}) {
  const { views, current, save, load, remove, setCurrent } = useSavedViews<T>(scope);
  const [open, setOpen] = useState(false);
  // Naming dialog state — opens when the user clicks "Save current as…".
  // We hold the live name here so Enter submits and Esc cancels without
  // any surprises from window.prompt.
  const [namingOpen, setNamingOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  function openNamingDialog() {
    setDraftName(`View ${views.length + 1}`);
    setNamingOpen(true);
    setOpen(false); // close the picker dropdown so it doesn't sit behind the modal
  }

  function commitSave() {
    const name = draftName.trim();
    if (!name) return;
    const view = save(name, currentState);
    setCurrent(view.id);
    setNamingOpen(false);
  }

  function handleLoad(id: string) {
    const state = load(id);
    if (state !== null) onLoad(state);
    setOpen(false);
  }

  function handleClear() {
    setCurrent(null);
    setOpen(false);
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium border border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
          >
            <Bookmark size={12} />
            <span className="truncate max-w-[140px]">
              {current ? current.name : "Saved views"}
            </span>
            <ChevronDown size={11} className="opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {views.length === 0 && (
            <div className="px-2 py-2 text-[11.5px] text-muted-2">
              No saved views yet.
            </div>
          )}
          {views.map((v) => {
            const active = current?.id === v.id;
            return (
              <DropdownMenuItem
                key={v.id}
                onSelect={(e) => {
                  e.preventDefault();
                  handleLoad(v.id);
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {active ? (
                    <Check size={11} className="text-[color:var(--accent-strong)] flex-shrink-0" />
                  ) : (
                    <span className="w-[11px]" aria-hidden />
                  )}
                  <span className="truncate text-[12px]">{v.name}</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    remove(v.id);
                  }}
                  className="text-muted-2 hover:text-rose-500 transition-colors flex-shrink-0"
                  aria-label={`Delete ${v.name}`}
                >
                  <Trash2 size={11} />
                </button>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              openNamingDialog();
            }}
            className="cursor-pointer"
          >
            <Plus size={12} className="mr-2" />
            <span className="text-[12px]">Save current as…</span>
          </DropdownMenuItem>
          {current && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleClear();
              }}
            >
              <span className="text-[12px] text-muted">Clear current view</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={namingOpen} onOpenChange={setNamingOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>
              Filters and sort applied right now will be saved under this name.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitSave();
            }}
            className="space-y-2"
          >
            <Label htmlFor="saved-view-name" className="text-[11.5px]">
              View name
            </Label>
            <Input
              id="saved-view-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
              placeholder="e.g. Engineering · active only"
            />
          </form>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNamingOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!draftName.trim()} onClick={commitSave}>
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
