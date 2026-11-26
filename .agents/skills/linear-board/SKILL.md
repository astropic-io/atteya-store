---
name: linear-board
description: How to write a Linear ticket (Agent ticket format, blocked-by links), building tickets in Claude Code Projects threads, Conflict Watch and the conflict-fix routine, and the self-review before a push. Read it before creating a Linear issue or changing the conflict-fix routine.
---

# Linear Board and Ticket Routine

Moved here word for word from AGENTS.md so that file stays small (<KEY>-282). The general Angular, Firebase and design rules stay in AGENTS.md.

**How to edit this file:** one fact per line, as a list item under the heading it belongs to. Add a new rule as its own line, or a new `##` heading for a new topic. Never join rules into one long paragraph: Git merges line by line, so two PRs that touch the same long line conflict even when they change different sentences.

## Building tickets in Projects threads

- Since Nov 26, 2026, tickets are built in Claude Code Projects threads, not by scheduled routines. The project's coordinator opens one thread per ask, and several threads build side by side, each in its own cloud session.
- A thread finds or creates the Linear issue (Agent ticket format below), moves it to **In Progress**, builds it on its own `<type>/<short-name>` branch, opens the PR and moves the issue on the board itself (AGENTS.md, board steps 1 to 3).
- A thread starts on a placeholder branch such as `claude/...`. Rename it before the first push (`git branch -m <type>/<short-name>`, see the `branch-naming` skill); the pre-push hook refuses the placeholder name. Never use `--no-verify`.
- Threads are cloud sessions with no Firebase credentials: they never run `fb:*` deploys, data scripts with `--apply` or anything on production. They list the dev deploy step in the PR and the Linear QA comment for the person who deploys.
- Tickets that edit the same files are still linked as **blocked by** in Linear, so the coordinator doesn't start them in parallel threads; the second one waits for the first PR to merge.
- The old `agent-ready` and `agent` labels, the **Model** label group (`Opus`, `Sonnet`, `Haiku`) and `npm run agent:build` are retired. Don't add those labels to new tickets.

## Conflict Watch and the conflict-fix routine

- Tickets built at the same time can edit the same files; the first PR to merge wins and a later one gets a merge conflict.
- `.github/workflows/conflict-watch.yml` ("Conflict Watch / Fix Conflicting PRs", on when the repo variable `CONFLICT_FIX` is `enabled`) runs after every push to `develop` (and is started by `auto-merge.yml` after each of its merges, since those start no push workflows) and when an owner's PR into `develop` is opened, reopened, marked ready or gets a new push (`pull_request_target`, because GitHub runs no `pull_request` workflow while a PR conflicts; it never checks out PR code).
- It finds open owner PRs into `develop` that conflict (not drafts, forks or `no-auto-merge`) and starts the Opus conflict-fix routine on claude.ai (`trig_01BzzGXbAheJgZo7kqRxGUh8`) with the message `Fix conflicts`, using the repo secret `ATTEYA_ROUTINE_TOKEN_OPUS`. It comments **🔀 Conflict Fix** · started on each PR, once per PR head and `develop` commit.
- The routine also runs on its hourly schedule as a fallback and fixes any conflicts Conflict Watch missed. It builds no tickets.
- The routine's prompt is `.claude/routines/ticket-pickup.md` (old name kept on purpose): its claude.ai prompt only tells it to read that file from `origin/develop`, so a change to the file takes effect once merged into `develop`.
- A conflict-fix run merges `develop` into each branch, keeps both sides of every conflict (`develop`'s side is never dropped; lock files are regenerated), runs the same checks as a build, and pushes as the repo owner, so CI, the Claude review and auto-merge carry on.
- It never touches a conflict under `.github/`, `.env*` or secrets. When it can't resolve something safely or a check fails, it pushes nothing and comments **🔀 Conflict Fix** · needs a person (PR and Linear) with the head commit; Conflict Watch then leaves that head alone.
- When the routine can't be started, Conflict Watch says "not started" once per PR head and reason, not on every push.
- After a change under `.github/workflows/` lands on `develop`, merging `develop` into an older branch may need a workflow permission the routine's push doesn't have, so expect those conflict fixes to come back as "needs a person": click Update branch on the PR or resolve them by hand.
- The routine's API token is created on its claude.ai page (Edit → Trigger → API → Generate token, shown once). A new token revokes the old one, so update the `ATTEYA_ROUTINE_TOKEN_OPUS` repo secret at the same time. Never commit a token or print it.
- Linear's team pull request automations (set Nov 7, 2026) do the status moves: draft PR open → **In Progress**, PR open or review activity → **To Review**, PR merge → **QA** (not Done; a person checks it on dev, then moves it to Done).

## Self-review before the push

- Before a thread pushes a build, it runs Claude Code's `/code-review` (`high` for money, stock, sign-in, rules, `functions/` or checkout; `medium` otherwise) and `/security-review` on its branch against `origin/develop` (`git remote set-head origin develop` first, or `/security-review` can't find the base), fixes the high and medium findings, runs the checks again, and lists the result in a "Self-review" section of the PR body.
- A conflict-fix run does the same when it resolved code by hand.

## Writing tickets

**Writing tickets (every agent that creates a Linear issue).** The person usually asks an agent to create tasks instead of writing them by hand, so every issue an agent creates in this project uses the "Agent ticket" format (also a Linear template with that name). Write the description as these Markdown sections, filled with real content, never hint text: `## What` (one or two sentences: the change and who it is for: shopper, admin or staff), `## Done when` (a `- [ ]` checklist of what to see on the dev site, including phone and desktop when it is UI), `## Where` (pages, admin screens, files or functions), `## Not in scope` (what must not change), `## Decisions already made` (exact wording, prices, colours, behaviour; write "None needed" when there are none), and optionally `## Notes`. When a ticket needs another one merged first, or edits the same files as another queued ticket, link it in Linear as **blocked by** that ticket (not only in the text): the coordinator reads those links to decide what can run in parallel. Set team and project from `linear.config.json`, status **Todo** (a bug: label `Bug`, status **Bugs**), and exactly one type label: `Bug`, `Feature` or `Improvement`. If something is undecided, add `Open Questions`, put it in **Backlog**, and list the questions in the description and in your reply; don't build it until they are answered. When the person asks for several tickets to be built at once, the coordinator opens one Projects thread per ticket (see **Building tickets in Projects threads** above).

## How to Test on Dev

**How to Test on Dev (<KEY>-87).** Every PR an agent opens (Projects threads, Claude Code, Cursor, Antigravity) carries a ready-made QA checklist, so testing a ticket on dev takes about 5 minutes:
- The PR body has a `## How to Test on Dev` section; Claude Fix, conflict fixes and docs-only PRs are no exception (a docs-only PR says what to read or run instead).
- Its first line is the rough time to test: `About 5 minutes.` (a plain estimate, 2 to 15 minutes).
- Then `Setup:` with what must happen on dev first, one per line: the deploy step (`npm run fb:fn:dev`, `fb:rules:dev`, …), the data script with its exact command, Rebuild search, a test offer or test product to create, or a signed-in test account; `Setup: none` when there is nothing.
- Then 3 to 6 `- [ ]` steps, each one action and what you should see (`- [ ] Phone: open /shop?onSale=1 → only discounted products show`), saying "phone" or "desktop" where it matters and naming pages by their path.
- Steps a signed-out person can't check (admin pages, account, a real order) say so in the step (`Admin, signed in: …`).
- When the PR opens, the same section is added to the end of the Linear issue description (replacing an older `## How to Test on Dev` section there), so it is on the issue when it reaches **QA** and can be ticked in Linear on a phone; no GitHub workflow or Linear key is needed.
- If later commits on the PR (a fix round, review changes) change what to test, update both copies before the merge; the person who moves the issue to **QA** checks the issue's copy still matches what merged.
