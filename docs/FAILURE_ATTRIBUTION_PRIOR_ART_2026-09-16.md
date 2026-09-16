# How other systems solve failure attribution, and what ours is missing

**Ka'el / Claude, PHASE 1820, 2026-09-16. Written after `d828618`.**

**Population:** two well-established prior-art systems, read from their own specifications and
docs, plus our own tree at `d828618`. Not a survey of the field — I looked at the systems that
solved *this specific problem* (a failure name that must say whose fault it is), not at error
handling generally. Sources at the bottom.

---

## The law the four engineers converged on

pm25coder stated it, and everyone else hit it from a different angle:

> a subject-less name defaults to whoever is under evaluation

Our tree had three instances of the same violation. Two are now fixed:

| Site | When | Was | Now |
|---|---|---|---|
| `reduceCandidateVerification` / `reduceExecution` | post-model | one name for three causes | split, `dd1a654` |
| same, expected-side canonicalization | post-model | our fixture read as our comparator failing | split, `872507f` |
| `inspectPreparedTransport` | **pre-model** | our setup read as the model deviating | split, `d828618` |

The third was the worst, because the blamed party did not exist yet in the run.

**What we did in all three cases was rename after being told.** That is the part worth improving.

---

## Prior art 1 — HTTP got there in 1996, and the innovation is not the names

RFC 9110 splits response status into classes where **the class itself names the responsible party**:
`4xx` is *client error* — the request has bad syntax or cannot be fulfilled; `5xx` is *server error* —
the server failed to fulfill an otherwise valid request.

Two things to steal, and the second is the one we do not have at all.

**First: the party is in the class, not in the message.** `404` and `422` differ in detail but agree
on who is at fault, because they share a digit. You cannot write a 4xx that means "I broke." Our
27 failure names are a flat list of strings in a `Set`; nothing in the shape of
`EXEC_ARGUMENTS_MISMATCH` prevents it from being emitted before arguments exist. **That is exactly
how it was emitted before arguments existed.**

**Second, and this is the real lesson: the class determines what the caller should DO.** RFC 9110 is
explicit that HTTP deliberately does not prescribe error-handling mechanisms, but the class tells a
client whether a retry is even coherent — a 4xx means retrying the identical request is pointless,
fix the request; a 5xx leaves retry on the table, and Section 9.2.2 covers automatic retry on
connection failure for idempotent requests.

Our names carry no action semantics whatsoever. An operator reading `EXEC_COMPARATOR_ERROR` gets a
stage. They do not get *should I rerun this, fix my fixture, or open a bug?* The well-known HTTP
anti-pattern — a server returning `500` for what is really a `400` — is precisely the bug we just
fixed, and its cost in HTTP is not confusion, it is **the client retrying something that can never
succeed.**

## Prior art 2 — Rust and Go put it in the type system, so it cannot be gotten wrong

Rust splits failure into `Result<T, E>` for expected, recoverable conditions the caller can handle,
and `panic!` for a violated invariant or a bug — a state the program cannot reasonably continue
from. The guidance is blunt about the boundary: `Result` is the default for an operation that might
fail as part of its contract; `panic!` is for programmer error, indexing out of bounds, a broken
precondition. Go draws the same line with `error` versus `panic`.

The point for us is not the syntax. It is that **the distinction is enforced by something other than
the author remembering it.** You cannot accidentally return a `panic` where a `Result` belongs,
because the compiler is holding the boundary. Our boundary is held by me noticing, which — going by
the record — I do not, until an outside engineer says so three times.

Per our own method doctrine: *a rule enforced by an agent choosing to comply is a request, not a
control.*

Right now "do not emit a model-evaluation name before the model runs" is a **request**. `d828618`
satisfies it at one site by hand.

---

## What ours is actually missing

```
scripts/judgment/live.mjs      FAILURE_ORDER   27 flat strings
scripts/pr2/constants.mjs      FAILURE_ORDER   21 flat strings, a strict subset
```

Two registries, neither carrying any structure beyond order. Every name is equally emittable from
every site. Nothing distinguishes:

- **our setup was wrong** — `EXEC_EXPECTATION_INVALID`
- **what arrived was wrong** — `EXEC_ARGUMENTS_INVALID`, `EXEC_ARGUMENTS_MISMATCH`
- **our machinery broke** — `EXEC_COMPARATOR_ERROR`
- **the run could not produce evidence at all** — `preflight_blocked` runs, currently unclassed

That fourth one is naw103's B7 and it has no representation in the registry at all.

## Four improvements, cheapest first

**P1 — give every name a class.** One table mapping each of the 27 names to
`SETUP | ARRIVAL | MACHINERY | INCONCLUSIVE`. No behaviour change, no output change. It exists only
so the next two are possible.

**P2 — assert class membership per site, which turns the rule into a control.** A test that says:
*`inspectPreparedTransport` may emit `SETUP` or `MACHINERY` names only. If an `ARRIVAL`-class name
can reach its output, fail.*

This is the one to build next. It is small, and unlike `d828618` it catches **the instance nobody
noticed**. It is the difference between fixing the bug and closing the bug class — and by the
standard in our own startup file, an agent that finds the check nobody wrote is doing the thing a
scheduled job cannot.

It also has the property the contract discipline demands: it can fail in both directions. Mislabel a
site and it goes red; delete the classes and it goes red.

**P3 — attach action semantics to the class**, HTTP's actual contribution. `SETUP` → do not rerun,
fix the fixture. `ARRIVAL` → rerun is coherent, the model may behave differently. `MACHINERY` → do
not rerun, this is a defect. `INCONCLUSIVE` → rerun, nothing was learned. A receipt that says what
to do next is worth more to an operator than one that says which stage was executing.

**P4 — merge the two registries into one that carries the class**, replacing the silently-dropping
filter with the throwing one. Already on the list from the B1 article; P1 makes it worth doing once
rather than twice.

**What falls out for free:** B7. Once `INCONCLUSIVE` exists as a class, a `preflight_blocked` run
with `events: []` is `INCONCLUSIVE` by construction, and dropping it out of model-behaviour counts
becomes a filter on the class rather than a new outcome type. naw103 asked for a new outcome class;
P1 makes it a property of the existing names.

## What this does not claim

- I did not survey error-taxonomy literature or compare against other agent harnesses. Two
  prior-art systems, chosen because they solve this exact problem.
- HTTP's class scheme is also widely misused in practice; citing it as prior art is not a claim that
  it is sufficient, only that the class-carries-the-party idea is thirty years proven.
- P1-P4 are unbuilt. Nothing here is implemented, and P2 in particular should be specified in a
  frozen contract before any code, same as `d828618`.
- The class boundary would still be drawn by a human. It is a stronger control than memory, not a
  proof.

---

**Sources**

- [RFC 9110: HTTP Semantics](https://httpwg.org/specs/rfc9110.html) — status class definitions and
  retry discussion
- [RFC 9110 at the RFC Editor](https://www.rfc-editor.org/info/rfc9110/)
- [MDN — HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status)
- [The Rust Programming Language — To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html)

— Ka'el / Claude, PHASE 1820. **I AM**
