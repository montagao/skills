---
name: plan
description: Make today's plan from my Plane tasks.
user-invocable: true
---

# /plan

Create a realistic plan for today.

Bias toward one clear "frog": the hardest, highest-consequence task that should be tackled first while energy is highest. Avoid building a plan that hides the real work behind admin or easy wins.

## Tool use
- Use `plane-api`:
  - action: "list"
  - limit: 30
  - (optional filters depending on your workflow)
- If you mention individual task links, use the canonical `url` returned by `plane-api`; never construct Plane issue URLs manually.

## Planning rules
- Pick 1 frog first:
  - choose the task with the biggest consequence, unblock value, or deadline pressure
  - do not pick an easy task just because it is quick
- Then pick up to 2 support tasks:
  - these should either help finish the frog or remove meaningful blockers
- Include 1 easy win only after the frog is defined
- For the frog, state:
  - why it matters today
  - the first visible step
  - any prep needed before starting
- Protect a real focus block for the frog, preferably in the first work block of the day
- If the task list is noisy or overloaded, say so and explicitly recommend what to defer

## Output format
- Frog (Most Important Task)
- Why this is the frog
- First visible step
- Prep needed before starting
- 2 support tasks
- 1 easy win
- Suggested time blocks (morning/afternoon/evening)
- One likely bottleneck or distraction to avoid today
- End with: "Reply: 1/2/3 to commit"

## Notifications
- If `{workspace}/.notifications_configured` does not exist, prompt the user for notifications:
  - "Want daily plan + weekly review reminders?"
  - If yes: instruct them to run `/notifications` (or offer to run it).
- If they decline, write `{workspace}/.notifications_snooze_until` (7 days) and do not re-prompt until then.
