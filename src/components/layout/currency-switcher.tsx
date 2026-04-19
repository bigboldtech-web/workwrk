"use client";

import { Coins, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { currencies, type Currency } from "@/lib/currency";
import { useCurrency } from "./currency-provider";

export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  const codes = Object.keys(currencies) as Currency[];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Change currency">
          <Coins size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
        {codes.map((code) => {
          const info = currencies[code];
          return (
            <DropdownMenuItem
              key={code}
              onClick={() => setCurrency(code)}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-2">
                <span className="w-10 font-mono text-xs text-muted">{info.code}</span>
                <span className="text-sm">{info.name}</span>
              </span>
              {code === currency && <Check size={14} className="text-[#d4ff2e]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
