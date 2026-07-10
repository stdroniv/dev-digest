# Rough design note — "Review Cost Ledger" (pasted by the user, not a spec)

We keep getting asked "how much did this PR review actually cost me". Sketch below is
from a whiteboard session, not a real mock — just so you know the shape we're picturing.

```
+-------------------------------------------------------+
| Review Cost Ledger                    [Compare ▾]     |
+-------------------------------------------------------+
| Run #482   gpt-5.4        12,400 tok   $0.19   ✓done  |
| Run #481   claude-sonnet   9,800 tok   $0.14   ✓done  |
| Run #479   gpt-5.4        14,100 tok   $0.21   ✗failed|
+-------------------------------------------------------+
| Toggle: "Compare against last 5 runs" (avg tok/cost)  |
+-------------------------------------------------------+
```

Ideas we scribbled down:
- A per-repo ledger of past review runs: model used, tokens, $ cost, pass/fail.
- A toggle that shows an average line ("last 5 runs averaged X tokens / $Y") so
  people can tell if a run was unusually expensive.
- Should probably live somewhere near the existing PR review screen.
- We don't want this to become a budget/spend-cap thing — just visibility for now.
- Not sure yet if failed runs should count toward the average or be excluded.
- Someone asked about CSV export — undecided, not committing to it yet.
