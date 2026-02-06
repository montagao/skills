---
name: ui-review
description: >
  Automated visual UI review and responsive QA testing using Agent Browser.
  Interviews the user to collect the target URL/route, test account credentials,
  and focus areas, then opens the app, logs in, and systematically screenshots
  and evaluates the UI at multiple viewport sizes (mobile, tablet, desktop,
  short/unusual heights). Uses $frontend-design for design quality assessment
  and responsive design best practices for breakpoint evaluation. Iterates with
  subagents until fully satisfied with scroll behavior, layout, typography,
  and visual polish. Use when: "review the UI", "test responsive design",
  "check how this page looks", "visual QA", "test at different screen sizes",
  "review this route", "does this look good on mobile", or any UI/visual
  quality review request.
---

# UI Review

Automated visual QA: interview the user, then test a web app's UI across viewports using Agent Browser, evaluate design quality, and iterate until satisfied.

## Process Overview

1. **Interview** — Gather route, credentials, and focus areas from user
2. **Login & Navigate** — Open the app and authenticate
3. **Multi-Viewport Capture** — Screenshot at 8+ viewport sizes
4. **Evaluate** — Score UI against design and responsive criteria
5. **Report** — Deliver findings with actionable recommendations
6. **Iterate** — Fix issues and re-test until all checks pass

## Step 1: Interview

Use `AskUserQuestion` to collect (skip any the user already provided):

1. **App URL** — Base URL (e.g., `http://localhost:3000`)
2. **Route to test** — Specific path (e.g., `/dashboard`, `/settings/profile`)
3. **Test credentials** — Email/username and password for login
4. **Login route** — Where the login form lives (default: `/login` or `/sign-in`)
5. **Focus areas** — What matters most: scroll behavior, layout, typography, specific components, mobile experience, etc.
6. **Viewport selection** — Standard set (8 viewports) or custom. See `references/viewports.md`.

Keep it to 2 questions per round. Move on once you have URL, route, and credentials at minimum.

## Step 2: Login & Navigate

Use Agent Browser with a named session so auth persists.

```bash
# Start session and navigate to login
agent-browser --session ui-review open "<app_url><login_route>"
agent-browser --session ui-review snapshot -i

# Fill login form (adapt selectors to actual form)
agent-browser --session ui-review fill "<email_field>" "<email>"
agent-browser --session ui-review fill "<password_field>" "<password>"
agent-browser --session ui-review click "<submit_button>"

# Wait for redirect
agent-browser --session ui-review wait --load networkidle
agent-browser --session ui-review snapshot -i
```

After login, navigate to the target route:
```bash
agent-browser --session ui-review open "<app_url><target_route>"
agent-browser --session ui-review wait --load networkidle
```

## Step 3: Multi-Viewport Capture

Minimum viewport set — test ALL of these:

| Label | Width | Height |
|-------|-------|--------|
| Mobile S | 375 | 667 |
| Mobile L | 430 | 932 |
| Tablet | 768 | 1024 |
| Tablet L | 1024 | 1366 |
| Laptop | 1366 | 768 |
| Desktop FHD | 1920 | 1080 |
| Short desktop | 1920 | 600 |
| Narrow desktop | 1024 | 768 |

For each viewport, open a **separate session** (most reliable for viewport sizing):

```bash
agent-browser --session "vp-<label>" open "<url>"
agent-browser --session "vp-<label>" eval "
  Object.defineProperty(window, 'innerWidth', {value: <width>, configurable: true});
  Object.defineProperty(window, 'innerHeight', {value: <height>, configurable: true});
  window.dispatchEvent(new Event('resize'));
"
agent-browser --session "vp-<label>" wait 1000
agent-browser --session "vp-<label>" screenshot "<scratchpad>/<label>.png" --full
```

If cookies don't transfer between sessions, log in again per session or reuse the main `ui-review` session and resize with eval.

Also test scroll behavior at each viewport:
```bash
agent-browser --session "vp-<label>" scroll down 500
agent-browser --session "vp-<label>" screenshot "<scratchpad>/<label>-scrolled.png"
agent-browser --session "vp-<label>" scroll up 500
```

**Use subagents** (Task tool, subagent_type=Bash) to parallelize viewport captures.

See `references/viewports.md` for additional viewport presets including unusual sizes.

## Step 4: Evaluate

For each screenshot, use the Read tool to view the image and evaluate against `references/review-criteria.md`.

**Use subagents** (Task tool) to parallelize evaluation — one subagent per viewport or per group of viewports.

Evaluate each screenshot for:
- **Layout & Spacing** — Content constrained, no overflow, proper whitespace
- **Typography** — Readable, proper hierarchy, comfortable line length
- **Navigation & Interactive** — Touch targets >=44px, button visibility
- **Visual Consistency** — Colors, images, decorative elements consistent
- **Scroll Behavior** — Smooth scroll, fixed elements don't overlap
- **Breakpoint Transitions** — Clean layout transitions between sizes
- **Content Priority** — Important content above fold

Apply `$frontend-design` principles:
- Does the design feel polished and intentional?
- Is there a clear visual hierarchy?
- Are colors, spacing, and typography harmonious?
- Does it avoid generic/template aesthetics?

Apply responsive design principles:
- Do breakpoint transitions feel natural?
- Is mobile content prioritized correctly?
- Are touch targets appropriately sized?
- Does the layout use available space well at each size?

## Step 5: Report

Write a structured report to `ui-review-report.md` (or user-specified path).

Include:
- Screenshot references for each viewport
- Per-viewport scores using criteria from `references/review-criteria.md`
- Cross-viewport summary
- Prioritized issue list
- Specific CSS/component fix recommendations

## Step 6: Iterate

If **Major** or **Critical** issues exist:

1. Present findings with specific fix suggestions
2. If user approves, implement the fixes
3. Re-run viewport capture and evaluation
4. Repeat until all viewports score **Pass** or **Minor** only

Use subagents for re-test cycles to keep context clean.

## Key Principles

- **Named sessions** — `--session ui-review` to persist login state
- **Screenshot everything** — visual evidence for every finding
- **Test scroll** — scrolled screenshots, not just top-of-page
- **Test extremes** — very short heights, very narrow widths catch edge cases
- **Subagents** — parallelize captures and evaluations via Task tool
- **Iterate** — re-test after fixes, don't stop at first report
