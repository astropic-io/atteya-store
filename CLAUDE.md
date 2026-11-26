# Claude Code entry point

Claude Code loads this file in every session (local, cloud and Projects threads). The full contract is `AGENTS.md`, imported here:

@AGENTS.md

## Always, before a push or a PR

- Before pushing a code change or opening a PR, run `/code-review` (`high` for money, stock, sign-in, Firestore or Storage rules, `functions/` or checkout; `medium` otherwise) and `/security-review` on the branch against `origin/develop`.
- Run `git remote set-head origin develop` first in a fresh clone or cloud session, or `/security-review` stops with "ambiguous argument 'origin/HEAD...'".
- Fix the high and medium findings, run the checks again, and list what each review found in a "Self-review" section of the PR body. A docs-only PR may skip `/code-review` and say so.
- If a review can't run at all (an error, not findings), say so in the "Self-review" section and carry on.
- Full rule: the `linear-board` skill ("Self-review before the push") and the `preflight-gate` skill.
