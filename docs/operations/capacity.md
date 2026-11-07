# Capacity: what one deployment is sized for

This sets the load the attendance path must carry and the latency it must
meet. `apps/backend/src/scripts/loadCheckinBurst.ts` measures against it, and its last
result is `docs/scorecard/evidence/load-checkin-burst.json`.

## The tenant-size assumption

These numbers are an assumption. They come from the pilot the roadmap
targets, a K-12 school in Monrovia, and from a mid-sized employer. They are
not measured from real traffic. Revise them when there is real traffic.

| | School | Employer |
|---|---|---|
| People checking in | 1,500 students | 300 employees |
| Arrival window | 15 minutes before first period | 10 minutes before the shift |
| Peak rate | 100 per minute | 30 per minute |

For the check-in burst test this is rounded up to **N = 120 check-ins per
minute** for one tenant. A school's register is a lecturer marking a class,
whose write rate is far below this. The burst that matters is people
checking in at a door or a kiosk.

## Targets at N

| Path | p95 |
|---|---|
| Manual check-in (with a reason) | under 500 ms |
| Face check-in, 1:1: challenge, three frames analysed by the worker, verification, check-in | under 4 s |

These are measured at the API, from one client machine. Phone networks
add their own latency.

## How it scales

- **The API is stateless.** Run more replicas behind the load balancer.
  Credential rate limits are shared in PostgreSQL.
- **Face analysis is the expensive part.** Each frame takes a few hundred
  milliseconds of CPU and a few hundred MB of memory per concurrent
  analysis (`FACE_ENGINE_CONCURRENCY`, default 2). To scale it out, run
  more face workers: `FACE_WORKER_URL` takes several addresses, separated by
  commas. The API sends each analysis to the next worker, and skips one it
  cannot reach.
- **Three frames per face check-in at 120 a minute is 6 analyses a second.**
  At about 0.3 to 0.5 s each that needs 2 to 3 concurrent analyses, so two
  workers at the default concurrency.

## Measured

The evidence file holds the latest run: the commit it was built from, the
command, the machine and, for each path, the most requests in flight,
throughput, error rate, p50, p95, p99 and maximum, and the database during
the burst. A development machine is not production hardware, and the file
says which it was.

To reproduce, against a throwaway database with the e2e stack running
(`RATE_LIMIT_API_PER_MINUTE` raised, face matching configured, fixtures
seeded by `scripts/run-all-e2e.sh`):

```bash
cd apps/backend && npx tsx src/scripts/loadCheckinBurst.ts --n 120 --sustain 30 --write
```

The last run (2026-11-07) tested the API and face worker started from
commit c53a401, with the extended load script not yet committed. It ran on
a development laptop (Intel i5-8350U, 4 cores and 8 threads, 8 GB) with the
API, PostgreSQL 16.15 in Docker and one face worker running two engine
processes (`FACE_ENGINE_PROCESSES=2`) all on it. The run before it used two
workers with the engine in the worker's own process.

| Path | Offered | Most in flight | Errors | p50 | p95 | p99 | Target met |
|---|---|---|---|---|---|---|---|
| Manual check-in | 120 a minute | 1 | 0 | 100 ms | 198 ms | 261 ms | yes (500 ms) |
| Face check-in | 120 a minute | 10 | 117 of 120 got "use manual" (97.5%) | 3.3 s | 4.5 s | 4.5 s, for the 3 that went through | **no** |
| Face check-in, after the burst | 30 a minute | 2 | 0 | 2.6 s | 3.6 s | 3.8 s | yes (4 s), at a quarter of N |

The database during the bursts: at most 26 connections and 4 active
statements, no statement waiting on a lock, no deadlocks. The sustained run
recorded 16 rollbacks against 1,752 commits; their cause was not traced.

Duplicates: each of 120 employees' check-ins was sent twice at the same
moment. With one idempotency key, every pair was answered 201 and 200 with
the same check-in. Without a key, every pair was answered 201 and 409
("already checked in"). Either way exactly one check-in and one event were
stored per request pair (240 of 240).

What this says:

- **The manual path carries the assumed load with ample room.** Its p95
  rose from 88 ms to 198 ms since the last run. Phase 4 added work to each
  check-in since then (the check-in controls, audit rows, the replay check);
  which of it costs what was not measured. It is still well inside the target.
- **Duplicates cannot double a check-in.** A retried request with a key
  gets back what it made; two without one, one is refused.
- **Face check-in at 120 a minute still needs several times this machine's
  CPU for face analysis.** About 6 analyses a second are needed. Two engine
  processes on this laptop, alongside everything else, managed under 1 at
  burst. When the worker's queue is full (`FACE_WORKER_MAX_QUEUE`, 8) it
  answers at once and the check-in falls back to manual (503
  `engine_unavailable`): that is the designed behaviour, and nothing failed
  outright. For the pilot that means four or more workers on hosts of
  their own, listed in `FACE_WORKER_URL`.
- **Recovery after an overload is now immediate:** the worker answered its
  health check at once after the burst, where the run before took 139 s.
  The engine runs in child processes, so the worker's HTTP loop is never
  blocked.
- **At 30 a minute one worker on this laptop meets the face target**, with
  p95 3.6 s. That is slower than the 1.3 s two in-process workers gave,
  because each analysis now crosses a process boundary and there was one
  worker, not two.
- **The face target is not met on this hardware.** The gate
  `checkin-burst-load` checks only that this document and the evidence
  exist. The evidence records `"met": false`.
