"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight, ArrowLeft, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TourStep {
  title: string;
  description: string;
  icon?: React.ReactNode;
  navigateTo?: string;          // Optional: navigate to a route when this step shows
  actionLabel?: string;         // Optional: custom button label
  highlight?: string;           // Optional: brief takeaway / "what to do" line
}

interface ProductTourProps {
  open: boolean;
  steps: TourStep[];
  title: string;
  subtitle?: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function ProductTour({ open, steps, title, subtitle, onClose, onComplete }: ProductTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const router = useRouter();

  // Reset to the first step each time the tour opens (state adjustment
  // during render, per react.dev "you might not need an effect").
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCurrentStep(0);
  }

  if (!open || steps.length === 0) return null;

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = () => {
    if (step.navigateTo) {
      router.push(step.navigateTo);
    }
    if (isLast) {
      onComplete?.();
      onClose();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleSkip = () => {
    onComplete?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-zinc-200 dark:border-[#2A2F38] bg-surface shadow-2xl">
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute right-3 top-3 p-1 rounded-md text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          aria-label="Skip tour"
        >
          <X size={16} />
        </button>

        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-surface-2 rounded-t-2xl overflow-hidden">
          <div
            className="h-full bg-[#0073EA] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-6 pt-7 pb-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#0073EA] mb-1.5">
            <Sparkles size={11} />
            <span>{title}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">Step {currentStep + 1} of {steps.length}</span>
          </div>
          {subtitle && currentStep === 0 && (
            <p className="text-xs text-muted mb-2">{subtitle}</p>
          )}
        </div>

        {/* Step content */}
        <div className="px-6 py-3">
          <div className="flex items-start gap-4">
            {step.icon && (
              <div className="shrink-0 w-12 h-12 rounded-xl bg-blue-50 dark:bg-[#0073EA]/15 flex items-center justify-center text-[#0073EA]">
                {step.icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground mb-1.5 leading-tight">{step.title}</h2>
              <p className="text-sm text-muted leading-relaxed whitespace-pre-line">{step.description}</p>
              {step.highlight && (
                <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 dark:border-[#0073EA]/25 dark:bg-[#0073EA]/10 px-3 py-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    <strong className="text-[#0073EA]">Tip:</strong> {step.highlight}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation footer */}
        <div className="px-6 py-4 flex items-center justify-between border-t border-border mt-3">
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === currentStep
                    ? "w-6 bg-[#0073EA]"
                    : i < currentStep
                    ? "w-1.5 bg-[#0073EA]/50"
                    : "w-1.5 bg-zinc-200 dark:bg-[#2A2F38]"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={handlePrev} className="text-xs h-8 gap-1">
                <ArrowLeft size={12} /> Back
              </Button>
            )}
            {!isLast && (
              <Button variant="ghost" size="sm" onClick={handleSkip} className="text-xs h-8 text-muted">
                Skip tour
              </Button>
            )}
            <Button size="sm" onClick={handleNext} className="text-xs h-8 gap-1.5">
              {isLast ? (
                <>
                  <CheckCircle2 size={12} /> {step.actionLabel || "Got it!"}
                </>
              ) : (
                <>
                  {step.actionLabel || (step.navigateTo ? "Take me there" : "Next")}
                  <ArrowRight size={12} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
