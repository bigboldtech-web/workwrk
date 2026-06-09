"use client";

import {
  Bot, CalendarDays, Eye,
  Layers, Lock, Plus, Settings, Star, Zap,
  type LucideIcon,
} from "lucide-react";
import { TaskListSurface } from "./task-list-surface";

export function AssignedToMeReferencePage() {
  return (
    <TaskSurface title="Assigned to me">
      <TaskListSurface />
    </TaskSurface>
  );
}

export function TodayOverdueReferencePage() {
  return (
    <TaskSurface title="Today & Overdue">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5 p-2.5">
        <section className="relative flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white !p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-zinc-900">My Work</h2>
            <IconButton Icon={Settings} label="Settings" />
          </div>
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 shadow-sm">
                <Layers className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="mb-4 text-[12px] text-zinc-600">
                Tasks and Reminders assigned to you will show here. <a href="#" className="text-[var(--os-brand-rail)]">Learn more</a>
              </p>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--os-brand-rail)] !px-2.5 text-[12px] font-medium text-white"
              >
                <Plus className="h-4 w-4" />
                Add task or reminder
              </button>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white !p-4">
          <h2 className="text-[14px] font-semibold text-zinc-900">Agenda</h2>
          <div className="flex flex-1 items-center justify-center text-center">
            <div className="w-full max-w-[360px]">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-zinc-300">
                <CalendarDays className="h-10 w-10" />
              </span>
              <p className="mx-auto mb-4 max-w-[260px] text-[12px] leading-5 text-zinc-600">
                Connect your calendar to view upcoming events and join your next call
              </p>
              <CalendarConnect label="Google Calendar" />
              <CalendarConnect label="Microsoft Outlook" />
            </div>
          </div>
        </section>
      </div>
    </TaskSurface>
  );
}

export function PersonalListReferencePage() {
  return (
    <TaskSurface
      title="Personal List"
      titlePrefix="My Tasks"
      headerRight={
        <div className="flex items-center gap-3 text-[12.5px] text-zinc-600">
          <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4" />View</span>
          <span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4" />Automate</span>
          <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4" />Ask</span>
        </div>
      }
    >
      <TaskListSurface />
    </TaskSurface>
  );
}

function TaskSurface({
  title,
  titlePrefix,
  headerRight,
  children,
}: {
  title: string;
  titlePrefix?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-10 shrink-0 items-center justify-between overflow-visible border-b border-zinc-200 !px-4">
        <h1 className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold leading-5 text-zinc-900">
          {titlePrefix ? <span className="shrink-0 font-medium text-zinc-500">{titlePrefix} /</span> : null}
          <span className="truncate">{title}</span>
          {title === "Personal List" ? (
            <>
              <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
              <Star className="h-4 w-4 shrink-0 text-zinc-500" />
            </>
          ) : null}
        </h1>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </header>
      {children}
    </div>
  );
}

function IconButton({ Icon, label, framed }: { Icon: LucideIcon; label: string; framed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-100 ${
        framed ? "border border-zinc-200" : ""
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function CalendarConnect({ label }: { label: string }) {
  return (
    <div className="mb-2 flex h-9 items-center justify-between rounded-lg border border-zinc-200 bg-white !px-2.5 text-left shadow-sm">
      <span className="text-[12.5px] font-medium text-zinc-800">{label}</span>
      <button type="button" className="rounded-md bg-zinc-100 !px-2 py-1 text-[12px] text-zinc-600">
        Connect
      </button>
    </div>
  );
}
