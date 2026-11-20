# Spike 5.1 — does `--resume` continue a session or fork it?

Date: 2026-11-20. Claude Code 2.1.316.

## Why this blocked Phase 5

The whole reply path assumes a message from the phone can be injected into one
named session. If `--resume` starts a copy instead, replies would land in a
detached clone the user never sees, and the design would need rethinking.

## Method

A scratch session in an empty directory, then two resumes against it, watching
the reported session id and the transcript files on disk.

## Result: it continues

```
resume reported session_id: b24d1f3f-85f3-4899-a111-861bc457b508
original target:            b24d1f3f-85f3-4899-a111-861bc457b508
same id: YES

transcript lines: 31 -> 42 -> 52
.jsonl files in the project directory: 2 before, 2 after
```

The id matches, the existing transcript grows, and no new transcript appears.
Every record in the file carries the same `sessionId`, and entries are linked
by `parentUuid`, so the resumed turns are part of one chain rather than a new
root.

Phase 5 proceeds as planned.

## What this spike did NOT prove

The CLI could not reach the API: `Failed to authenticate: OAuth session expired
and could not be refreshed`. Transcripts are still written, so the mechanical
question above is answered, but two things remain open:

1. **Context continuity.** That the resumed turn can *see* the earlier
   conversation is untested. The `parentUuid` chain and shared `sessionId` make
   it very likely, but likely is not proven.
2. **Resuming a session that is currently running.** This is the caveat the
   queue-when-busy design (D6) exists for. It could not be tested, because an
   unauthenticated session exits immediately and never occupies the id.

No lock file appears anywhere under the project directory while a session is
active, so nothing in the filesystem prevents a concurrent resume. D6 therefore
stands: hold replies until the session is idle. The queue costs latency when the
assumption is wrong in our favour, and prevents a forked session when it is not.

Re-run both open items once `claude` can authenticate again.
