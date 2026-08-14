# WorkwrK product documentation

This directory holds the product documentation for WorkwrK, written for **our own team first** and destined for documentation.ai.

Files are `.mdx` with YAML frontmatter. Everything here is source. Nothing here is generated.

## The honesty rule

This is the whole point of this documentation, so it comes before anything else.

**Document only what actually works.** Before writing that the product does something, verify it: read the route or component that produces the behaviour, or probe the running app. If you have not seen the code path, do not describe the behaviour.

Concretely:

- If a feature is half built, either leave it out or state plainly what works and what does not.
- Never describe an aspiration as a capability. "Will support" and "supports" are different words.
- When a link between two modules looks obvious but does not exist, say so explicitly. A reader who assumes a connection and builds on it wastes more time than one who reads "not wired yet".
- A page that lies is worse than a missing page. There is no partial credit.

If you find something in these docs that does not match the product, that is a high priority bug. Fix the page or say something.

Every claim in the current pages was verified against the codebase on 2026-08-14. When a page makes a factual assertion it generally names the file, the route or the interface path it came from, so the next person can re-verify it in seconds instead of trusting it.

## Structure

```
docs/product/
  README.md              this file
  getting-started/       what WorkwrK is, the core concepts, first week setup
  using/                 day to day: spaces and tasks, views, goals, my profile, docs, time and search
  admin/                 setting the org up: functions and levels, people and invites, roles/KRAs/KPIs, reviews, settings
  reference/             how the system is, rather than how to do a thing
    how-it-connects.mdx            the interconnection map: real data flows, and the links that are absent
    visibility-and-permissions.mdx the three-door model in practice, per module
    status.mdx                     every module: Built / In progress / Coming soon
    glossary.mdx                   Function, Level, Role, KRA, KPI, Goal, SOP, Space, List, Item and friends
```

The split is by intent. `getting-started/` and `using/` are for someone doing a task. `admin/` is for someone configuring the workspace. `reference/` is for someone who needs to know how the machine actually behaves.

A useful reading order for a new joiner: `getting-started/what-is-workwrk`, then `reference/glossary`, then `reference/status`, then whichever `using/` page matches their job. Anyone about to build on top of WorkwrK should read `reference/how-it-connects` first.

## Voice

- Second person. "You" and "your", not "the user".
- Plain and direct. Complete sentences. Short paragraphs.
- No marketing language. No adjectives that cannot be checked.
- Concrete paths through the interface: "People → Departments", `/team/kpi-reviews`. Never "navigate to the relevant section".
- No em dashes and no double hyphens. Use commas, colons and full stops. Code tokens are exempt.

## Frontmatter

Every `.mdx` file starts with:

```
---
title: Page title
description: One sentence saying what this page tells you.
---
```

`title` becomes the page heading and the nav label. `description` is the subtitle and the search snippet. Keep the description honest too: if the page documents a partially built area, the description should not promise a finished one.

## Diagrams

Use Mermaid in a fenced ```mermaid block. Keep node labels short and only draw edges that exist in the code. A diagram is a claim like any other sentence, and it is a claim people trust more, so it deserves more scrutiny, not less.

## Publishing to documentation.ai

Not yet connected. When the documentation.ai project is set up, the flow is:

1. **Connect the repo.** In documentation.ai, create the project and point it at this repository with `docs/product` as the content root. It reads `.mdx` from the connected branch.
2. **Set the nav.** documentation.ai derives structure from the directory tree and page frontmatter. `reference/` becomes a section. Page order inside a section is set in the project config, not in the files, so nothing here needs to change to reorder pages.
3. **Publish on merge.** Point the project at `main`. A merge to `main` that touches `docs/product` publishes. Anything not merged is not live.
4. **Review before publishing.** documentation.ai supports branches and pull requests within a project. For a batch of changes, open a branch there, review the rendered result, then merge.

Until that connection exists, these files are the source of truth and are read directly from the repository.

## Adding a page

1. Decide which directory it belongs in: `getting-started/`, `using/`, `admin/` or `reference/`.
2. Write it, verifying every claim as you go.
3. Where you assert behaviour, note in your own head which file or route proved it. If you cannot name one, you have not verified it.
4. Check `status.mdx`. If your page documents a module, its status entry must agree with your page. If they disagree, one of them is wrong and you should find out which before publishing either.

## What deliberately is not here

Nothing in this directory covers HRIS or payroll. WorkwrK is explicitly not either of those, and those modules were removed from the product. If you are looking for salary, benefits, leave accrual or statutory filing, they do not exist here and are not planned.
