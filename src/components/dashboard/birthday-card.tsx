"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Cake, PartyPopper, Gift, Calendar } from "lucide-react";

export function BirthdayCard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/birthdays")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setData(d.data); })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const { todayBirthdays, upcoming, isMyBirthday, companyName } = data;

  // No birthdays today or upcoming — don't show
  if (todayBirthdays.length === 0 && upcoming.length === 0) return null;

  // Show special card if it's the current user's birthday
  if (isMyBirthday) {
    return (
      <Card className="border-[rgba(255,61,138,0.3)] bg-gradient-to-r from-[rgba(255,61,138,0.08)] via-[rgba(255,153,51,0.06)] to-[rgba(212,255,46,0.06)] overflow-hidden relative">
        <CardContent className="p-6 text-center relative z-10">
          <div className="flex justify-center gap-2 mb-3">
            <PartyPopper size={28} className="text-[#ff9933]" />
            <Cake size={28} className="text-[#ff3d8a]" />
            <Gift size={28} className="text-[#d4ff2e]" />
          </div>
          <h2 className="text-xl font-bold mb-2 text-[#fafafa]">Happy Birthday! 🎂</h2>
          <p className="text-sm text-[#a0a0a0] mb-1">
            Thank you for being a wonderful part of{" "}
            <span className="font-semibold text-[#d4ff2e]">{companyName}</span>!
          </p>
          <p className="text-xs text-[#a0a0a0]">
            We appreciate everything you do and wish you an amazing year ahead!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-pink-500/20">
      <CardContent className="p-4">
        {/* Today's Birthdays */}
        {todayBirthdays.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Cake size={16} className="text-pink-400" />
              <span className="text-sm font-semibold">Today&apos;s Birthdays</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {todayBirthdays.map((u: any) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-pink-500/5 border border-pink-500/10">
                  <Avatar className="h-8 w-8">
                    {u.avatar ? (
                      <img src={u.avatar} alt="" className="h-full w-full object-cover rounded-full" />
                    ) : (
                      <AvatarFallback className="text-xs bg-pink-500/20 text-pink-400">{u.firstName[0]}{u.lastName[0]}</AvatarFallback>
                    )}
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{u.firstName} {u.lastName} 🎂</p>
                    <p className="text-[10px] text-muted">{u.department?.name || u.role?.title || ""}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Birthdays */}
        {upcoming.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={14} className="text-muted" />
              <span className="text-xs text-muted">Upcoming this week</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {upcoming.map((u: any) => (
                <div key={u.id} className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-foreground">{u.firstName} {u.lastName}</span>
                  <span>in {u.daysUntil} day{u.daysUntil !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
