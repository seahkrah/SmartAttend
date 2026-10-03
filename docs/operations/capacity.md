# Capacity: what one deployment is sized for

This sets the load the attendance path must carry and the latency it must
meet. `scripts/load-checkin-burst.ts` measures against it, and its last
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

The evidence file holds the latest run: the commit, the machine, the number
of workers, and p50, p95 and maximum for each path. A development machine is
not production hardware, and the file says which it was.

The last run was on a development laptop: 4 cores and 8 threads, 8 GB, with
the API, PostgreSQL and two face workers all on it.

| Path | Rate | Errors | p95 | Target met |
|---|---|---|---|---|
| Manual check-in | 120 a minute | 0 | 88 ms | yes |
| Face check-in | 120 a minute | 108 of 120 got "use manual" | 9.9 s for the 12 that went through | **no** |
| Face check-in | 30 a minute | 0 | 1.3 s | yes, at a quarter of N |

What this says:

- **The manual path carries the assumed load with ample room.**
- **Face check-in at 120 a minute needs about four times this machine's
  CPU for face analysis:** about 6 analyses a second, where this laptop
  managed about 1.5 alongside everything else. For the pilot that means
  four or more workers on hosts of their own. When the workers are full,
  check-ins fall back to manual (503 `engine_unavailable`). That is the
  designed behaviour, and nothing failed outright.
- **Recovery after an overload is slow:** the workers took 139 s to answer
  their health checks again. TensorFlow's work blocks a worker's event loop,
  so health checks and disconnects queue behind the backlog. Moving the
  engine into a worker thread, so the HTTP loop stays responsive, is the
  fix. **Not done yet.**
- **The face target is not met on this hardware.** The gate
  `checkin-burst-load` checks only that this document and the evidence
  exist. The evidence records `"met": false`.
