// The consent page's card and its error pages (docs/plans/mcp-server.md 6.1),
// built from AuthCard and AuthBanner alone, in the sign-in pages' existing
// classes: no new visual design, one blue Allow and a plain Deny. A plain
// POST form, sent only once (submit-once-form.tsx: a double click on Allow
// cannot strand the code). Allow is armed only once the person has had the
// page in front of them for a moment and moved or typed (guarded-allow.tsx,
// src/lib/oauth/allow-guard.ts; final review, security M1), so with no
// script only Deny works, and a line in a noscript says so.
// Every sentence comes from src/lib/mcp/mcp-copy.ts. Server component.

import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { MCP_CONSENT_COPY as C } from "@/lib/mcp/mcp-copy";
import type { AuthorizeView } from "@/lib/oauth/authorize";
import type { ConsentErrorKey, ConsentView } from "@/lib/oauth/consent";
import { GuardedAllow } from "./guarded-allow";
import { SubmitOnceForm } from "./submit-once-form";

type Shown = Exclude<ConsentView, { kind: "redirect" }> | Exclude<AuthorizeView, { kind: "redirect" }>;

function Message({ title, body, link }: { title: string; body: string; link?: { href: string; text: string } }) {
  return (
    <AuthCard
      title={title}
      subtitle={body}
      footer={
        link ? (
          <a className="wa-btn wa-btn--secondary wa-btn--block" href={link.href}>
            {link.text}
          </a>
        ) : undefined
      }
    />
  );
}

export function OAuthCard({ view }: { view: Shown }) {
  switch (view.kind) {
    case "error": {
      const e = C.errors[view.error as ConsentErrorKey];
      return <Message title={e.title} body={e.body} />;
    }
    case "appError":
      return <Message title={C.appError.title(view.label)} body={C.appError.body} link={{ href: view.backHref, text: C.appError.backTo(view.label) }} />;
    case "stale":
      return <Message title={C.stale.title} body={C.stale.body} link={{ href: view.loginHref, text: C.stale.link }} />;
    case "noWorkspace":
      return <Message title={C.noWorkspace.title} body={C.noWorkspace.body} link={{ href: view.cancelHref, text: C.noWorkspace.link }} />;
    case "form":
      return <ConsentForm view={view} />;
  }
}

function ConsentForm({ view }: { view: Extract<ConsentView, { kind: "form" }> }) {
  return (
    <AuthCard
      title={C.consentTitle(view.label)}
      subtitle={view.email ? C.asWho(view.email) : undefined}
      banner={<AuthBanner tone="warning">{C.notChecked}</AuthBanner>}
      footer={
        <p>
          <a className="wa-link wa-link--sm" href={view.notYouHref}>
            {C.notYou}
          </a>
        </p>
      }
    >
      <SubmitOnceForm action="/oauth/decision" className="wa-form">
        <input type="hidden" name="request" value={view.request} />
        <input type="hidden" name="csrf" value={view.csrf} />
        <p className="wa-text">{C.redirectLine(view.target)}</p>
        <div className="wa-field">
          <label className="wa-label" htmlFor="oauth-workspace">
            {C.workspaceLabel}
          </label>
          <select id="oauth-workspace" name="workspace" className="wa-input" defaultValue={view.selected}>
            {view.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {view.unavailable > 0 ? <p className="wa-field-note">{C.otherWorkspaces(view.unavailable)}</p> : null}
        </div>
        <div className="wa-field" role="radiogroup" aria-labelledby="oauth-access">
          <span className="wa-label" id="oauth-access">
            {C.accessLabel}
          </span>
          <label className="wa-text">
            <input type="radio" name="access" value="read" defaultChecked={!view.writeAsked} /> {C.accessRead}
          </label>
          <label className="wa-text">
            <input type="radio" name="access" value="write" defaultChecked={view.writeAsked} disabled={!view.writeAsked} /> {C.accessWrite}
          </label>
          {view.writeAsked ? null : <p className="wa-field-note">{C.accessWriteNotAsked}</p>}
        </div>
        <p className="wa-help">{C.never}</p>
        <p className="wa-help">{C.whereItGoes}</p>
        <noscript>
          <p className="wa-help">{C.needsScript}</p>
        </noscript>
        <div className="wa-row2">
          <GuardedAllow label={C.allow} />
          <button type="submit" name="action" value="deny" className="wa-btn wa-btn--secondary wa-btn--block">
            {C.deny}
          </button>
        </div>
      </SubmitOnceForm>
    </AuthCard>
  );
}
