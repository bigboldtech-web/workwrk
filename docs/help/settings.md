---
title: Settings
description: The two doors to settings in WorkwrK, what lives behind each, and who can open them.
---

<!--
For the founder: copy for the documentation.ai "Workwrk" project, Guides tab.
Written in Phase 8 stage F because the documentation.ai connector was not
reachable from this session. Components used are the platform's own:
Callout (kinds info, tip, success, alert, danger) and Expandable. Publish the
page first and add it to the navigation last.
-->

# Settings

Settings open full screen, with two doors. **Back to app** (or Esc) returns you to exactly where you were.

## My settings (everyone)

Open it from your avatar menu, **My settings**, or the **Settings** icon at the bottom of the rail.

| Page | What you set |
|---|---|
| **Profile** | Your name, photo, phone and date of birth. |
| **Preferences** | Appearance (Light, Dark, System, density), language and region, and your sidebar. |
| **Notifications** | What reaches you, and where: presets (Default, Focused, Custom), email and desktop, and mutes. |
| **Security** | Your password, two step verification, backup codes, and signing out of every device. |
| **Calendar & connections** | Google Calendar and your calendar feed. |
| **Keyboard shortcuts** | Every shortcut; press **?** anywhere to see the same list. |
| **All settings** | Every setting on one page, searchable. |

## Workspace settings (Owners and Admins)

| Group | Pages |
|---|---|
| Workspace | Overview, Identity & culture, Locale & work week, Apps & modules |
| People | Members, Structure, Access |
| Work | Task system, Scoring & reviews |
| Security & data | Security, Data, Audit log, API & webhooks |
| Billing | Plan & billing |

<Callout kind="info">
Security, API & webhooks and Plan & billing are the Owner pages. An Admin can open them when an Owner gives them the Billing or the Security scope on their row in Members.
</Callout>

The **People team** can read Members, Structure, Access and Scoring. Everyone else who follows a link to a Workspace page sees their own Profile with a line naming the Admins who look after that page, so nobody meets a dead end.

## Saving

Every setting either saves as you change it (you see **Saved**) or collects your changes in a bar at the bottom of the page with **Save** and **Discard**. If a save fails, the page says so and keeps your change so you can try again. Leaving a page with unsaved changes asks first.

## The audit log

Every change to who can do what, and every workspace setting, lands in **Workspace settings > Audit log** with who made it and when. Owners and Admins can export the log as CSV.

<Expandable title="Rows you may see during an access change-over">
While WorkwrK moves to its new access rules, a workspace may run a week where the new rules are checked but not yet applied. During that week the log shows rows such as "Opened Scoring & reviews in Workspace settings, which the new access rules would refuse (log only, nothing changed)". Nothing changed for that person; the rows exist so the Owner can see who a rule change would affect before it takes effect.
</Expandable>

## Apps & modules

Turn premium modules (Talk, Tables) on or off, and decide which apps show in everyone's rail and who can see each one. Before a hide or a raised minimum role is saved, the page counts the people who lose access and names the first few.

<Callout kind="alert">
Turning a module off locks its content for everyone until it is turned on again. Nothing is deleted.
</Callout>
