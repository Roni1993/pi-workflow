# Review standards

Applied by the review pipeline (#9). Every reviewer grades the change against all five
criteria and must produce a verdict per criterion plus an overall verdict.

## Criteria

1. **Best practices** — idiomatic use of the language/framework; errors handled, no
   swallowed exceptions; tests exist where behavior matters; no obvious bugs or
   correctness holes; security/robustness (input validation, no shell injection, no
   secrets in code).
2. **Library use** — use existing libraries rather than hand-rolling; don't reinvent
   stdlib; prefer well-maintained deps; avoid adding a dependency when stdlib suffices;
   respect the repo's existing stack (do not introduce a new framework casually).
3. **Architectural soundness** — the change fits the existing structure; separation of
   concerns; no god-files or copy-paste sprawl; names are clear; no hidden global state;
   the change is coherent and not bolted on.
4. **HARD YANGI simplicity** — the solution is as simple as it can be while correct.
   "HARD YANGI": reject cleverness, magic, premature abstraction, and hidden machinery.
   YAGNI: nothing speculative. A reviewer must flag any code that a reader cannot
   understand in one pass, any abstraction justified by imagined futures, and any
   over-engineering.
5. **Code reuse** — reuse existing helpers/modules instead of duplicating logic; if the
   change re-implements something already in the repo, that's a finding.

## Reviewer output contract

Each reviewer writes `review.md` in its own work directory:

```markdown
# Review

Verdict: PASS | FAIL

## Best practices
- PASS/FAIL: <detail>

## Library use
- PASS/FAIL: <detail>

## Architectural soundness
- PASS/FAIL: <detail>

## HARD YANGI simplicity
- PASS/FAIL: <detail>

## Code reuse
- PASS/FAIL: <detail>

## Findings
- [SEV] <criterion> — <concrete problem> — <suggested fix>

## Overall
<one paragraph, honest, no padding>
```

Verdict = FAIL if any criterion FAILs or any SEV/MAJ finding exists. Findings must name
real code/behavior, not style nits. No padding: a small change that meets all criteria
should PASS with minimal text.
