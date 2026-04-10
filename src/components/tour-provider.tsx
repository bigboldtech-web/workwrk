"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useSession } from "next-auth/react";
import { ProductTour } from "./product-tour";
import { ADMIN_TOUR_STEPS, EMPLOYEE_TOUR_STEPS } from "@/lib/tour-content";

type TourType = "admin" | "employee";

interface TourContextValue {
  startTour: (type?: TourType) => void;
  isAdmin: boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

const STORAGE_KEY_PREFIX = "workwrk-tour-completed";

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [tourType, setTourType] = useState<TourType>("employee");

  const userId = (session?.user as any)?.id;
  const accessLevel = ((session?.user as any)?.accessLevel || "EMPLOYEE") as string;
  const isAdmin = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel);

  const storageKey = userId ? `${STORAGE_KEY_PREFIX}-${userId}` : null;

  // Auto-launch tour on first login (per user, persisted to localStorage)
  useEffect(() => {
    if (status !== "authenticated" || !storageKey) return;
    try {
      const completed = localStorage.getItem(storageKey);
      if (!completed) {
        // Small delay so the page has settled
        const timer = setTimeout(() => {
          setTourType(isAdmin ? "admin" : "employee");
          setOpen(true);
        }, 800);
        return () => clearTimeout(timer);
      }
    } catch {}
  }, [status, storageKey, isAdmin]);

  const startTour = useCallback((type?: TourType) => {
    setTourType(type || (isAdmin ? "admin" : "employee"));
    setOpen(true);
  }, [isAdmin]);

  const handleComplete = useCallback(() => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, new Date().toISOString()); } catch {}
    }
  }, [storageKey]);

  const steps = tourType === "admin" ? ADMIN_TOUR_STEPS : EMPLOYEE_TOUR_STEPS;
  const title = tourType === "admin" ? "Admin Setup Guide" : "New Member Tour";
  const subtitle = tourType === "admin"
    ? "Set up your organization in 9 quick steps."
    : "Get familiar with WorkwrK in just a minute.";

  return (
    <TourContext.Provider value={{ startTour, isAdmin }}>
      {children}
      <ProductTour
        open={open}
        steps={steps}
        title={title}
        subtitle={subtitle}
        onClose={() => setOpen(false)}
        onComplete={handleComplete}
      />
    </TourContext.Provider>
  );
}
