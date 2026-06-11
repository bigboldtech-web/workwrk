"use client";

import { useState } from "react";
import { X, Trophy, Rocket, Timer, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useOsShell } from "./shell-context";
import { useRouter } from "next/navigation";
import { taupeButton } from "@/components/ui/accent";

export function CreateListModal() {
  const { createListOpen, closeCreateList } = useOsShell();
  const [listName, setListName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const router = useRouter();

  if (!createListOpen) return null;

  const handleCreate = () => {
    closeCreateList();
    router.push("/tasks/personal-list");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 transition-opacity" 
        onClick={closeCreateList} 
        aria-hidden="true" 
      />

      {/* Modal Content */}
      <div 
        className="relative w-full max-w-[500px] bg-white rounded-[14px] shadow-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-list-title"
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between">
          <div className="flex flex-col gap-3">
            <h2 id="create-list-title" className="text-xl font-bold text-zinc-900">
              Create List
            </h2>
            <div className="flex items-center gap-2">
              <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Trophy className="w-3.5 h-3.5" />
                Goals
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Rocket className="w-3.5 h-3.5" />
                Roadmap
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
                <Timer className="w-3.5 h-3.5" />
                Tracker
              </button>
            </div>
          </div>
          <button 
            type="button" 
            onClick={closeCreateList}
            className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="px-5 py-4 flex flex-col gap-5">
          {/* Name Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-zinc-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input 
              type="text" 
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="Your list or project name"
              autoFocus
              className="w-full px-3 py-2 text-[14px] bg-white border border-[#c39b8c] rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-[#c39b8c]/20 transition-all placeholder:text-zinc-400"
            />
          </div>

          {/* Space Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-zinc-700">
              Space (location)
            </label>
            <button 
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-red-500 text-white font-medium text-[10px]">
                  X
                </div>
                <span className="text-[14px] text-zinc-900 font-medium">XYZ</span>
              </div>
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            </button>
          </div>

          {/* Privacy Toggle */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-zinc-800">Make private</span>
              <span className="text-[13px] text-zinc-500">Only you and invited members have access</span>
            </div>
            <Switch checked={isPrivate} onChange={setIsPrivate} aria-label="Make list private" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between bg-white mt-2 pb-6">
          <button 
            type="button"
            className="px-4 py-2 text-[13px] font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
          >
            Use Templates
          </button>
          <button 
            type="button"
            onClick={handleCreate}
            className={`px-6 py-2 text-[13px] rounded-lg shadow-sm ${taupeButton}`}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
