"use client";

import { useState, useEffect } from "react";
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
  const router = useRouter();

  useEffect(() => {
    if (open) setCurrentStep(0);
  }, [open]);

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
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-[rgba(212,255,46,0.25)] bg-surface shadow-2xl">
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
            className="h-full bg-gradient-to-r from-[#d4ff2e] to-[#5eead4] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-6 pt-7 pb-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#d4ff2e] mb-1.5">
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
              <div className="shrink-0 w-12 h-12 rounded-xl bg-[rgba(212,255,46,0.12)] border border-[rgba(212,255,46,0.3)] flex items-center justify-center text-[#d4ff2e]">
                {step.icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground mb-1.5 leading-tight">{step.title}</h2>
              <p className="text-sm text-muted leading-relaxed whitespace-pre-line">{step.description}</p>
              {step.highlight && (
                <div className="mt-3 rounded-lg border border-[rgba(212,255,46,0.25)] bg-[rgba(212,255,46,0.06)] px-3 py-2">
                  <p className="text-xs text-[#d4ff2e]">
                    <strong className="text-[#e2ff6b]">Tip:</strong> {step.highlight}
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
                    ? "w-6 bg-[#d4ff2e]"
                    : i < currentStep
                    ? "w-1.5 bg-[rgba(212,255,46,0.5)]"
                    : "w-1.5 bg-border"
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
