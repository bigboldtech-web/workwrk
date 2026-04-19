"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import { useTour } from "@/components/tour-provider";

interface SetupItem {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

interface SettingsResponse {
  settings?: { companyProfile?: { about?: string } };
}

const STORAGE_KEY = "workwrk-setup-checklist-dismissed";

export function AdminSetupChecklist() {
  const { startTour, isAdmin } = useTour();
  const [items, setItems] = useState<SetupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "true") setDismissed(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAdmin || dismissed) return;
    Promise.all([
      fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/users?limit=200").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/kras?limit=500").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/sops").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/departments").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/policies").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([settings, users, kras, sops, depts, policies]) => {
        const profile = (settings as SettingsResponse | null)?.settings?.companyProfile ?? {};
        const userList = Array.isArray(users) ? users : users?.data || [];
        const kraList = Array.isArray(kras) ? kras : kras?.data || [];
        const sopList = Array.isArray(sops) ? sops : sops?.data || [];
        const deptList = Array.isArray(depts) ? depts : depts?.data || [];
        const policyList = Array.isArray(policies) ? policies : policies?.data || [];

        const checks: SetupItem[] = [
          {
            key: "profile",
            label: "Set up your company profile",
            description: "Add mission, vision, values and a description so AI knows your business.",
            href: "/organization",
            done: !!(profile.about && profile.about.length > 30),
          },
          {
            key: "departments",
            label: "Create departments",
            description: "Organize people by department for better structure.",
            href: "/organization",
            done: deptList.length > 0,
          },
          {
            key: "team",
            label: "Invite your team",
            description: "Add the people who'll use WorkwrK.",
            href: "/settings",
            done: userList.length > 1,
          },
          {
            key: "kras",
            label: "Create KRAs and KPIs",
            description: "Define what each role is accountable for. Use AI to generate them in seconds.",
            href: "/kra-kpi",
            done: kraList.length > 0,
          },
          {
            key: "sops",
            label: "Document a process (SOP)",
            description: "Create your first SOP — a step-by-step playbook for how things get done.",
            href: "/sops",
            done: sopList.length > 0,
          },
          {
            key: "policies",
            label: "Publish a policy",
            description: "Add your first HR or compliance policy so employees can acknowledge it.",
            href: "/policies",
            done: policyList.length > 0,
          },
        ];

        setItems(checks);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, dismissed]);

  if (!isAdmin || dismissed) return null;
  if (loading) return null;

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = completed === total;

  if (allDone) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    setDismissed(true);
  };

  return (
    <div
      style={{
        background: "#141414",
        border: "1px solid rgba(212, 255, 46, 0.25)",
        borderRadius: 16,
        padding: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient lime glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -60,
          left: -40,
          width: 220,
          height: 220,
          background: "radial-gradient(circle, rgba(212,255,46,0.12), transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textAlign: "left",
            flex: 1,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "#fafafa",
            padding: 0,
          }}
        >
          {collapsed ? (
            <ChevronRight size={16} style={{ color: "#a0a0a0", flexShrink: 0 }} />
          ) : (
            <ChevronDown size={16} style={{ color: "#a0a0a0", flexShrink: 0 }} />
          )}
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "rgba(212, 255, 46, 0.12)",
              border: "1px solid rgba(212, 255, 46, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#d4ff2e",
              flexShrink: 0,
            }}
          >
            <Sparkles size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#fafafa", margin: 0 }}>
              Finish setting up WorkwrK
            </p>
            <p style={{ fontSize: 12, color: "#a0a0a0", margin: "2px 0 0" }}>
              {completed} of {total} steps complete
            </p>
          </div>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => startTour("admin")}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#ededed",
              borderRadius: 100,
              fontSize: 11.5,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#1a1a1a";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.14)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
            }}
          >
            Replay tour
          </button>
          <button
            onClick={dismiss}
            style={{
              color: "#a0a0a0",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          borderRadius: 100,
          background: "rgba(255, 255, 255, 0.06)",
          overflow: "hidden",
          marginBottom: 16,
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(completed / total) * 100}%`,
            background: "linear-gradient(90deg, #d4ff2e, #5eead4)",
            borderRadius: 100,
            boxShadow: "0 0 10px rgba(212, 255, 46, 0.5)",
            transition: "width 0.5s cubic-bezier(0.2, 0.9, 0.3, 1)",
          }}
        />
      </div>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
          {items.map((item) => (
            <Link key={item.key} href={item.href} style={{ textDecoration: "none" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  borderRadius: 10,
                  padding: 10,
                  transition: "background 0.2s",
                  opacity: item.done ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!item.done) e.currentTarget.style.background = "#1a1a1a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {item.done ? (
                  <CheckCircle2
                    size={16}
                    style={{ color: "#d4ff2e", flexShrink: 0, marginTop: 2 }}
                  />
                ) : (
                  <Circle size={16} style={{ color: "#707070", flexShrink: 0, marginTop: 2 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: item.done ? "#707070" : "#fafafa",
                      textDecoration: item.done ? "line-through" : "none",
                      margin: 0,
                    }}
                  >
                    {item.label}
                  </p>
                  {!item.done && (
                    <p
                      style={{
                        fontSize: 11.5,
                        color: "#a0a0a0",
                        marginTop: 2,
                        lineHeight: 1.45,
                        margin: "2px 0 0",
                      }}
                    >
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
