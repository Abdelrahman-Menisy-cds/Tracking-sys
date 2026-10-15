# H18 fix-up 2 — the launcher must notice a freshly linked model (and the probe's own bugs)

Backend is green: `pytest -q accounts/test_assistant.py` → **21 passed**. The
`key_source` derivation was fixed (`api_key_set_by_id == user_id → "self"`), and
the server has been restarted so that change is live.

The H18 probe (`frontend/scripts/probe-h18-afaf-assistant.mjs`, run against
`http://192.168.1.19:8080` with a stub provider) currently reports:

```
hover/focus shows the link-a-model hint             : PASS
faded launcher does not open the chat panel         : PASS
profile widget mounts (#assistant section)          : PASS
Test button shows ok + latency (stub proves call)   : FAIL  (تم حفظ إعدادات المساعد. stubCalls=0)
launcher enabled after linking (Test passed)        : FAIL  (muted=true)
chat panel opens                                    : FAIL
message sends, reply renders (stub proves call)     : FAIL  (reply="" stubCalls=1)
→ then: Error: Uncaught at probe line 457
```

The UI is actually working: the widget saved, and the Test button really called
the stub ("الاتصال ناجح — زمن الاستجابة 11 ملي ثانية") with the stub logging
`stubHits=1` / `/v1/chat/completions`. So three things are wrong:

1. **Product bug — the launcher does not pick up a newly saved config.** After
   the widget saves (and Test succeeds) the launcher is still `muted`/disabled, so
   the chat panel cannot open. Fix it so the saved config reaches the launcher's
   state without a page reload. First determine the truth and report it: does a
   **page reload** enable the launcher? If yes it is a state-propagation bug (the
   widget's save must update the shared assistant state / refetch the config);
   if it stays disabled after a reload, the config read or `is_configured`/
   `is_active` handling is wrong. Fix the real cause — an employee who just linked
   a model must not have to reload to use the assistant.
2. **Probe bug — the stub call counter.** `stubCalls=0` while the stub itself
   logged `stubHits=1`: the probe counts wrong (it likely reads the counter
   before the request lands, or from a variable that was reset). The counter is
   the proof that the app really called the provider — make it reliable.
3. **Probe crash at line 457** (`Error: Uncaught`): an `evaluate` on the page
   throws. Guard it and report which step it was, instead of dying mid-run.

Then rerun the probe end to end and paste the per-check lines + the final verdict,
plus screenshots under `/home/menisy/.hermes/cache/scratch/h18-shots/`: the faded
launcher with its hint, the **open chat panel with a confirmation card**, and the
profile widget. Never fake a screenshot or a result; if a check cannot run, say
exactly which and why. Do not commit, stage, or stash anything.
