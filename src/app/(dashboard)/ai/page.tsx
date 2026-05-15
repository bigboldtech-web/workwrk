"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Send, Sparkles, User, Loader2, History, Trash2, BookmarkPlus, Bookmark,
  TrendingUp, AlertTriangle, Users, CheckSquare, BarChart3, BookOpen, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  getSavedPrompts, saveAIPrompt, removeAIPrompt, subscribeAIPrompts, type SavedPrompt,
} from "@/lib/ai-prompts";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type DigestHighlight = {
  label: string;
  value: string | number;
  detail: string;
};

type Digest = {
  period: string;
  highlights: DigestHighlight[];
  alerts: string[];
};

const suggestedQueries = [
  { icon: TrendingUp, text: "Who are my top 5 performers this month?" },
  { icon: AlertTriangle, text: "Show me all overdue P0 tasks" },
  { icon: BookOpen, text: "Which SOPs have the lowest compliance?" },
  { icon: BarChart3, text: "Compare Sales vs Engineering performance" },
  { icon: Users, text: "Who should I promote this quarter?" },
  { icon: CheckSquare, text: "Show me team workload distribution" },
  { icon: TrendingUp, text: "What's our task completion rate this week?" },
  { icon: AlertTriangle, text: "Who is at risk of leaving?" },
];

function renderMarkdown(text: string) {
  // Simple markdown rendering for bold, headers, bullet points, code
  return text
    .split("\n")
    .map((line, i) => {
      // Headers
      if (line.startsWith("### ")) return <h4 key={i} className="font-semibold text-sm mt-2 mb-1">{line.slice(4)}</h4>;
      if (line.startsWith("## ")) return <h3 key={i} className="font-semibold text-base mt-2 mb-1">{line.slice(3)}</h3>;
      if (line.startsWith("# ")) return <h2 key={i} className="font-bold text-lg mt-2 mb-1">{line.slice(2)}</h2>;

      // Bullet points
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const content = line.slice(2);
        return (
          <div key={i} className="flex gap-2 ml-2">
            <span className="text-[color:var(--accent-strong)] flex-shrink-0">•</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(content) }} />
          </div>
        );
      }

      // Numbered lists
      const numMatch = line.match(/^(\d+)\.\s(.+)/);
      if (numMatch) {
        return (
          <div key={i} className="flex gap-2 ml-2">
            <span className="text-[color:var(--accent-strong)] flex-shrink-0 font-mono text-xs mt-0.5">{numMatch[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(numMatch[2]) }} />
          </div>
        );
      }

      // Empty lines
      if (!line.trim()) return <div key={i} className="h-2" />;

      // Regular text with bold
      return <p key={i} dangerouslySetInnerHTML={{ __html: boldify(line) }} />;
    });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function boldify(text: string): string {
  // Escape HTML first to prevent XSS, then apply formatting
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-border px-1 py-0.5 rounded text-[color:var(--accent-strong)] text-xs font-mono">$1</code>');
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I'm the WorkwrK AI Assistant. I can help you understand your organization's performance, analyze team data, and make data-driven decisions.\n\nTry asking me about your team's performance, overdue tasks, SOP compliance, or anything else about your business.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loadingDigest, setLoadingDigest] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  // Prompt library (localStorage) + query history (server). Both live
  // in topbar-style dropdowns next to the input so the chat surface
  // doesn't lose vertical space.
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savePromptName, setSavePromptName] = useState("");
  const [pastQueries, setPastQueries] = useState<{ id: string; query: string; createdAt: string }[]>([]);
  useEffect(() => {
    setSavedPrompts(getSavedPrompts());
    return subscribeAIPrompts(() => setSavedPrompts(getSavedPrompts()));
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { error: toastError, success: toastSuccess } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load weekly digest
  useEffect(() => {
    fetch("/api/ai/digest")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setDigest(data); })
      .catch(() => {})
      .finally(() => setLoadingDigest(false));
  }, []);

  // Load conversation history on mount
  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        // Server response is wrapped by jsonSuccess: `{ data: { history } }`.
        // Older shape may have surfaced `data.history` directly — accept
        // both so a half-rolled-out server doesn't break the page.
        const history = data?.data?.history ?? data?.history;
        if (Array.isArray(history) && history.length > 0) {
          setShowHistory(true);
          // Stash for the History dropdown — distinct from the chat
          // messages array which mixes user + assistant turns.
          setPastQueries(
            history.map((h: { id: string; query: string; createdAt: string }) => ({
              id: h.id, query: h.query, createdAt: h.createdAt,
            })),
          );
          const historicalMessages: Message[] = [];
          for (const entry of history.slice(-10)) {
            historicalMessages.push({
              id: `h-u-${entry.id}`,
              role: "user",
              content: entry.query,
              timestamp: new Date(entry.createdAt),
            });
            historicalMessages.push({
              id: `h-a-${entry.id}`,
              role: "assistant",
              content: entry.response,
              timestamp: new Date(entry.createdAt),
            });
          }
          setMessages((prev) => [prev[0], ...historicalMessages]);
        }
      })
      .catch(() => {});
  }, []);

  const handleClearHistory = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Conversation cleared. How can I help you?",
        timestamp: new Date(),
      },
    ]);
    setShowHistory(false);
  };

  async function handleSend(query?: string) {
    const text = query || input.trim();
    if (!text || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // Build conversation history for context (exclude welcome message)
    const conversationHistory = messages
      .filter((m) => m.id !== "welcome" && !m.id.startsWith("h-"))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, conversationHistory }),
      });

      const data = await res.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response || "I couldn't process that query. Please try again.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      toastError("AI query failed", "Please try again.");
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Sorry, I encountered an error. Please make sure the system is properly configured and try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const hasConversation = messages.length > 1;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col animate-fade-in">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <PageHeader
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "AI Assistant" }]}
          kicker="AI · private-by-default"
          title="AI assistant"
          subtitle="Ask anything about your organization in plain English."
        />
        {hasConversation && (
          <Button variant="outline" size="sm" onClick={handleClearHistory} className="gap-2 text-muted">
            <Trash2 size={14} /> Clear Chat
          </Button>
        )}
      </div>

      {/* Digest Banner */}
      {!loadingDigest && digest && !hasConversation && (
        <Card className="mb-4 border-[rgba(212,255,46,0.2)] bg-[rgba(212,255,46,0.06)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-[color:var(--accent-strong)]" />
              <span className="text-sm font-medium">Weekly Digest</span>
              <Badge variant="secondary" className="text-[10px]">{digest.period}</Badge>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {digest.highlights.map((h, i) => (
                <div key={i} className="text-center">
                  <p className="text-lg font-bold font-mono">{h.value}</p>
                  <p className="text-[10px] text-muted">{h.label}</p>
                </div>
              ))}
            </div>
            {digest.alerts.length > 0 && (
              <div className="mt-3 space-y-1">
                {digest.alerts.map((alert, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-orange-400">
                    <AlertTriangle size={12} /> {alert}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chat Area */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[rgba(212,255,46,0.08)] flex items-center justify-center">
                  <Sparkles size={16} className="text-[color:var(--accent-strong)]" />
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-violet-600 text-[#0a0a0a]"
                    : "bg-surface-2 border border-border text-foreground"
                }`}
              >
                {msg.role === "assistant" && (
                  <p className="text-[10px] text-[color:var(--accent-strong)] font-mono mb-1 font-medium">workwrk AI</p>
                )}
                <div className="text-sm leading-relaxed">
                  {msg.role === "assistant" ? renderMarkdown(msg.content) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-[color:var(--accent-strong)]" : "text-muted"}`}>
                  {msg.timestamp.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[rgba(212,255,46,0.12)] flex items-center justify-center">
                  <User size={16} className="text-[color:var(--accent-strong)]" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[rgba(212,255,46,0.08)] flex items-center justify-center">
                <Sparkles size={16} className="text-[color:var(--accent-strong)]" />
              </div>
              <div className="bg-surface-2 border border-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  Analyzing your data...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        {/* Suggested Queries */}
        {messages.length <= 1 && (
          <div className="border-t border-border p-4">
            <p className="text-xs text-muted mb-2">Quick queries:</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {suggestedQueries.map((q) => {
                const Icon = q.icon;
                return (
                  <button
                    key={q.text}
                    onClick={() => handleSend(q.text)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted hover:border-violet-500/40 hover:text-[#e2ff6b] transition-colors text-left"
                  >
                    <Icon size={12} className="flex-shrink-0" />
                    <span className="line-clamp-2">{q.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Saved prompts library — user's localStorage favorites. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11.5px] font-medium border border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
                >
                  <Bookmark size={11} />
                  Library
                  {savedPrompts.length > 0 && (
                    <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0">
                      {savedPrompts.length}
                    </Badge>
                  )}
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Your prompts</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {savedPrompts.length === 0 ? (
                  <div className="px-2 py-2 text-[11.5px] text-muted-2">
                    Save a prompt below to reuse it later.
                  </div>
                ) : (
                  savedPrompts.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        setInput(p.text);
                      }}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="text-[12px] font-medium block truncate">{p.name}</span>
                        <span className="text-[10.5px] text-muted-2 line-clamp-1 block">{p.text}</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeAIPrompt(p.id);
                        }}
                        className="text-muted-2 hover:text-rose-500 flex-shrink-0 mt-0.5"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!input.trim()}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!input.trim()) return;
                    setSavePromptName(input.slice(0, 60));
                    setSavePromptOpen(true);
                  }}
                  className="cursor-pointer"
                >
                  <BookmarkPlus size={12} className="mr-2" />
                  <span className="text-[12px]">Save current prompt…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Past queries — pulled from /api/ai (AIQuery table). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11.5px] font-medium border border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
                  disabled={pastQueries.length === 0}
                >
                  <History size={11} />
                  History
                  {pastQueries.length > 0 && (
                    <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0">
                      {pastQueries.length}
                    </Badge>
                  )}
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Recent queries</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {pastQueries.length === 0 ? (
                  <div className="px-2 py-2 text-[11.5px] text-muted-2">
                    Your past questions will show up here.
                  </div>
                ) : (
                  // Newest first — `history` came back reversed (oldest-first)
                  // from the server, so we re-reverse for the picker.
                  [...pastQueries].reverse().map((q) => (
                    <DropdownMenuItem
                      key={q.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        setInput(q.query);
                      }}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="text-[12px] line-clamp-2">{q.query}</span>
                      <span className="text-[10px] text-muted-2">
                        {new Date(q.createdAt).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-[10.5px] text-muted-2 ml-auto">
              Cmd/Ctrl + Enter to send
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (!loading && input.trim()) handleSend();
                }
              }}
              placeholder="Ask about your team, performance, tasks, SOPs..."
              className="flex-1"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()} className="gap-2">
              <Send size={16} />
              Ask
            </Button>
          </form>
        </div>
      </Card>

      {/* Save-prompt dialog — captures a custom name so the library entry
          isn't just the raw prompt text truncated. Submit-on-Enter, Esc
          cancels (Dialog primitive handles that for us). */}
      <Dialog open={savePromptOpen} onOpenChange={setSavePromptOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save prompt</DialogTitle>
            <DialogDescription>
              Give this prompt a short name so you can spot it in your library later.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = savePromptName.trim();
              if (!name || !input.trim()) return;
              saveAIPrompt(name, input);
              setSavePromptOpen(false);
              toastSuccess("Prompt saved");
            }}
            className="space-y-2"
          >
            <Label htmlFor="save-prompt-name" className="text-[11.5px]">Name</Label>
            <Input
              id="save-prompt-name"
              value={savePromptName}
              onChange={(e) => setSavePromptName(e.target.value)}
              autoFocus
              maxLength={80}
              placeholder="e.g. Top performers monthly check"
            />
            <p className="text-[10.5px] text-muted-2 line-clamp-2">
              <span className="font-medium">Prompt:</span> {input}
            </p>
          </form>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSavePromptOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!savePromptName.trim() || !input.trim()}
              onClick={() => {
                const name = savePromptName.trim();
                if (!name || !input.trim()) return;
                saveAIPrompt(name, input);
                setSavePromptOpen(false);
                toastSuccess("Prompt saved");
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
