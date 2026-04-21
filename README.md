# Rate-Limited API Service

A production-considerate REST API with per-user rate limiting using a **sliding window** algorithm.

---

## Features

| Feature | Detail |
|---|---|
| Rate limiting algorithm | Sliding window (avoids fixed-window burst at boundaries) |
| Limit | 5 requests · per user · per 60-second window |
| Concurrency safety | Safe for Node.js single-process (see Limitations) |
| Headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` |
| Tests | Unit + integration + parallel concurrency stress test |
| Container | Dockerfile with health check |

---

## Steps to Run

### Prerequisites

- Node.js ≥ 18  
- npm ≥ 9

### 1 — Install & Start

```bash
git clone <repo-url>
cd rate-limited-api
npm install
npm start
# → Listening on http://localhost:3000
```

### 2 — Run Tests

```bash
npm test
```

### 3 — Docker

```bash
docker build -t rate-limited-api .
docker run -p 3000:3000 rate-limited-api
```

---

## API Reference

### `POST /request`

Submit a request on behalf of a user.

**Body** (JSON):

```json
{ "user_id": "alice", "payload": { "action": "buy", "item": "book" } }
```

**Success — 202 Accepted**

```json
{
  "success": true,
  "data": {
    "requestId": "req_1714000000000_x7k2mq",
    "userId": "alice",
    "payload": { "action": "buy", "item": "book" },
    "processedAt": "2024-04-25T10:00:00.000Z"
  },
  "rateLimit": {
    "remaining": 4,
    "resetAt": "2024-04-25T10:01:00.000Z"
  }
}
```

**Rate limit exceeded — 429 Too Many Requests**

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit of 5 requests per 60s exceeded.",
  "retryAfter": 42,
  "resetAt": "2024-04-25T10:01:00.000Z"
}
```

Response headers included on every response:

```
X-RateLimit-Limit:     5
X-RateLimit-Remaining: 3
X-RateLimit-Reset:     1714000060     (Unix timestamp)
Retry-After:           42             (seconds, only on 429)
```

---

### `GET /stats`

**All users (aggregate)**

```
GET /stats
```

```json
{
  "totalUsers": 2,
  "totalRequests": 7,
  "users": [
    { "userId": "alice", "totalRequests": 5, "currentWindowCount": 2, "remaining": 3, "lastRequestAt": "..." },
    { "userId": "bob",   "totalRequests": 2, "currentWindowCount": 0, "remaining": 5, "lastRequestAt": "..." }
  ]
}
```

**Single user**

```
GET /stats?user_id=alice
```

```json
{
  "userId": "alice",
  "totalRequests": 5,
  "requests": [ ... ],
  "rateLimit": {
    "windowMs": 60000,
    "maxRequests": 5,
    "count": 2,
    "remaining": 3,
    "resetAt": "2024-04-25T10:01:00.000Z"
  }
}
```

---

### `GET /health`

```json
{ "status": "ok" }
```

---

## Design Decisions

### 1 · Sliding Window over Fixed Window

A **fixed window** resets its counter on a hard clock boundary (e.g., every full minute). This means a user can make 5 requests at 00:59 and 5 more at 01:01 — 10 requests within a 2-second span — without ever being blocked.

A **sliding window** stores the actual timestamp of every request and prunes those older than `windowMs` on each call. The limit is always calculated over the most recent 60 seconds, regardless of clock alignment. This eliminates the boundary-burst problem entirely.

Trade-off: O(n) memory per user proportional to `maxRequests`, but n ≤ 5 here so it is negligible.

### 2 · Synchronous State Mutations

Node.js is single-threaded. JavaScript callbacks, Promises, and `async/await` never interrupt each other mid-execution (cooperative, not preemptive). Therefore, the `consume()` function — which reads then writes the timestamp array atomically within a single synchronous call — has **no data races** in a single-process deployment.

The concurrency test in `tests/api.test.js` fires 20 parallel requests and asserts exactly 5 succeed, verifying this.

### 3 · Factory Pattern for Testability

`createApp({ limiter, store })` accepts injected dependencies. Tests instantiate their own `RateLimiter` with a short `windowMs` (e.g., 100 ms) without touching global state. No mocking frameworks needed.

### 4 · Decoupled Store and Limiter

`RateLimiter` only tracks timestamps for rate-limit decisions. `RequestStore` holds the processed record data for stats. This separation lets you swap either component (e.g., Redis rate limiter + PostgreSQL store) without touching the other.

### 5 · Standard HTTP Semantics

- `202 Accepted` (not `200 OK`) — the body was accepted for processing; in a real service the payload would be queued.
- `429 Too Many Requests` with `Retry-After` header — RFC 6585 compliant.
- `X-RateLimit-*` headers on every response — lets clients track their budget without waiting for a 429.

---

## Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| **In-memory state** | Restarting the process clears all rate-limit windows and request history | Use Redis (see below) |
| **Single-process only** | A second Node.js process (e.g., two containers, pm2 cluster) has its own memory; a user sees 5 × N slots | Shared atomic store (Redis + Lua scripts, or Redlock) |
| **No persistence** | Stats are lost on restart | Write records to a database (Postgres, MongoDB) |
| **No authentication** | Any caller can supply any `user_id` | Add API key / JWT middleware |
| **Unbounded user growth** | Every new `user_id` is tracked forever in memory | Add LRU eviction or TTL-based cleanup |

---

## What I Would Improve with More Time

### Immediate (production blockers)

1. **Redis-backed rate limiter** — use an atomic Lua script (GET + ZADD + ZREMRANGEBYSCORE + EXPIRE in one round trip) to safely support multiple instances.
2. **Database persistence** — write request records to PostgreSQL so stats survive restarts and support pagination.
3. **Authentication middleware** — validate a bearer token or API key before trusting `user_id`.

### Short-term

4. **Request queueing** — instead of hard-rejecting at 429, place excess requests in a BullMQ queue and return a job ID the client can poll.
5. **Configuration via environment variables** — `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `PORT`.
6. **Structured logging** — replace `console.error` with pino/winston for JSON logs compatible with cloud log aggregators.
7. **OpenAPI spec** — auto-generate docs with swagger-jsdoc.

### Longer term

8. **Tiered rate limits** — different limits per user role (free vs. paid).
9. **Distributed tracing** — add OpenTelemetry spans so individual request latencies are visible in Grafana / Datadog.
10. **Cloud deployment** — Azure Container Apps or AWS App Runner with a managed Redis instance (Azure Cache for Redis / ElastiCache).

---

## Project Structure

```
rate-limited-api/
├── src/
│   ├── rateLimiter.js   # Sliding-window algorithm
│   ├── store.js         # In-memory request store
│   └── app.js           # Express app factory
├── tests/
│   └── api.test.js      # Unit + integration + concurrency tests
├── index.js             # Entry point
├── Dockerfile
└── README.md
```
