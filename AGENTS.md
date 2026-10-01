# StreetLens development

- Start independent features from the latest `origin/main` in their own branch and worktree. Do not switch another active worktree or mix in unrelated data-source/UI changes.
- Keep integrations small and move feature logic into focused modules. Check `origin/main` again before handoff and resolve any overlap on the feature branch.
- Run `npm run ci` for every development handoff. It includes the existing typecheck, production build, score integrity, assessment policy and snapshot preservation gates, plus walk/saved-score unit and browser tests. Install the test browser once with `npx playwright install --with-deps chromium --only-shell`.
- Add regression tests for behavioral changes, especially saved-data integrity, asynchronous races and scoring. Never weaken a gate or change an expected result simply to make it pass.
- Keep external-data health (`npm run check:external-data`) separate from deterministic CI. Report network/credential limitations distinctly; a skipped check is not a pass.
- Backend source data and bounded field observations determine CLS. Walk feelings and photos are personal records and do not fabricate or alter baseline scores.
- Preserve personal history/evidence. Database retention, object-storage migration and destructive cleanup require a concrete migration plan; this branch's storage report is read-only.
- Deliver feature branches for review. Do not merge or deploy into a concurrently used environment unless requested.
