"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { locales, localeNames, type Locale } from "@/i18n/config";

export function LanguageSwitcher() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(locale: Locale) {
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} aria-label="Change language">
          <Globe size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => change(locale)}
            className="flex items-center justify-between gap-3"
          >
            <span>{localeNames[locale]}</span>
            {locale === current && <Check size={14} className="text-[#d4ff2e]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
