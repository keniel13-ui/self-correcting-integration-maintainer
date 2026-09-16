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
on who is at fault, because they share a digit.

**Bounded, after a breaker catch — the class does not PREVENT misuse, it makes misuse NAMEABLE.**
An earlier version of this line said *"you cannot write a 4xx that means I broke."* That is false:
servers return wrong 4xx codes constantly, and the RFC itself hedges — §15.5 says the client
*"seems to have erred"* (fetched `2026-09-16T21:48:18Z`, `rfc9110.txt` line 7534), not that it did.

What the class actually buys is that **`500`-for-a-`400` is identifiable as wrong by anyone reading
the response**, without access to the server. That is the property we want, and it is weaker and
more useful than prevention. Our 27 names are flat strings in a `Set`; nothing in the shape of
`EXEC_ARGUMENTS_MISMATCH` marks it as an arrival-class name, so its emission before any arguments
arrived was **not detectable from the receipt** — an outside reader had no way to know the name was
structurally impossible there. **That** is the gap, and it is what P2 below closes.

**Second — CORRECTED TWICE; see both correction notes below. HTTP does NOT attach the action to the
class.** §9.2.2 ties automatic retry to **method idempotency**, not to status class. And a 4xx can
be explicitly retryable — `408 Request Timeout`, §15.5.9, verbatim:

> If the client has an outstanding request in transit, it MAY repeat that request.

Fetched `2026-09-16T21:48:18Z`:

```
$ curl -s https://www.rfc-editor.org/rfc/rfc9110.txt | grep -c '429'
0
$ ... | grep -c 'Too Many Requests'
0
$ sed -n '7645,7646p' rfc9110.txt
   If the client has an outstanding request in transit, it MAY repeat
   that request.
```

**That zero is the second correction.** An earlier version of this paragraph cited `429 Too Many
Requests` as a 9110 counterexample. **429 is not in RFC 9110 at all** — it is RFC 6585 §4, where
rate limiting *"MAY include a Retry-After header."* `408` alone carries the argument, and it is in
9110.

So the class answers *whose fault*; *what to do* is carried separately, by the specific code and by
properties of the method. The RFC makes that split explicit in the same §15.5 sentence: the server
SHOULD send a representation explaining the error **"and whether it is a temporary or permanent"**
condition — temporary-versus-permanent being the action-relevant fact, deliberately placed in the
*representation* rather than in the class.

That separation is the opposite of what I first wrote, and it is the sharper lesson. **Attribution
and remediation are two axes.** Our 27 names encode neither.

Our names carry neither axis. An operator reading `EXEC_COMPARATOR_ERROR` gets a stage. They do not
get whose fault it was, and they do not get *should I rerun this, fix my fixture, or open a bug?*

The HTTP anti-pattern of returning `500` for what is really a `400` is precisely the bug we just
fixed. Its cost is **misattribution** — the caller is told the server failed when the caller's own
request was malformed. I previously wrote that its cost was the client retrying something that can
never succeed; that followed from the retry claim Aethar refuted and it does not survive. Retry
behaviour in HTTP hangs off idempotency and off specific codes, not off the class.

## Prior art 2 — Rust and Go put it in the type system, so it cannot be gotten wrong

Rust splits failure into `Result<T, E>` for expected, recoverable conditions the caller can handle,
and `panic!` for a violated invariant or a bug — a state the program cannot reasonably continue
from. The guidance is blunt about the boundary: `Result` is the default for an operation that might
fail as part of its contract; `panic!` is for programmer error, indexing out of bounds, a broken
precondition. Go is usually described as drawing the same line with `error` versus `panic`, but
**no seat fetched the Go documentation**, so treat that sentence as maker-asserted and unverified —
it is here as a lead, not as evidence.

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

**P3 — carry remediation as a SECOND field, not as a property of the class.** Revised after the
correction above: attaching the action to the class is the thing HTTP deliberately did *not* do, and
for good reason — `SETUP` failures are not uniformly "do not rerun" any more than 4xx is. A stale
fixture and an unsatisfiable fixture are both `SETUP` and only one is fixed by regenerating it.

So: one field for **who** (`SETUP | ARRIVAL | MACHINERY | INCONCLUSIVE`) and a separate field for
**what to do** (`RERUN_UNCHANGED | REGENERATE_FIXTURE | FILE_DEFECT | NOTHING_LEARNED`). Two axes,
independently assignable, because collapsing them is a smaller version of the same mistake this
whole document is about: **one label doing two jobs.**

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


---

## Corrections — three, and the second correction needed a third

**This memo went public inside `bb7d047` with a false claim about RFC 9110**, and then the fix for
it carried a second false claim. Both were found by Aethar, a non-maker seat, by fetching the file.
Recorded in order because the sequence is the finding.

**C1 — the original overclaim.** Published: *a 4xx status means retrying the identical request is
pointless.* False. §9.2.2 ties automatic retry to **method idempotency**, not to status class, and
`408` is a 4xx the RFC explicitly permits repeating.

**C2 — the correction cited a status code that is not in the document.** My C1 fix offered `408`
**and `429 Too Many Requests`** as 9110 counterexamples. **429 does not appear in RFC 9110.** Zero
occurrences, and zero for the phrase. It is RFC 6585 §4. Aethar searched the file; I had not, in the
act of correcting a claim about that same file for not having searched it. `408` alone carries the
argument.

**C3 — "you cannot write a 4xx that means I broke" was too strong.** Servers send wrong 4xx codes
routinely, and §15.5 itself says the client *"seems to have erred."* Bounded above to what is
actually true and more useful: the class does not prevent misuse, it makes misuse **nameable from
outside**. Which is precisely the property our flat name list lacks, and what P2 closes.

**What holds, verified at the source:** §15.5 *"the client seems to have erred"*, §15.6 *"the server
is aware that it has erred"*. Class-names-the-party stands. Class-determines-the-action does not.

**The corrections improved the argument each time.** HTTP separates attribution from remediation on
purpose — §15.5 puts temporary-versus-permanent in the *representation*, not the class — so P3 was
rewritten from "attach the action to the class," which HTTP declined to do, to "carry remediation as
a second field." Collapsing the two would have been a smaller instance of the exact defect this memo
is about.

**The lesson C2 teaches that C1 did not:** I corrected a spec claim by fetching *part* of the spec.
A partial fetch reported as a verified correction is the same defect one level up, and it is why
`CLAUDE.md` now requires **the command and its output in the same message** — visible, so the gap
between "I checked" and "here is what the check printed" cannot hide. The `grep -c '429'` returning
`0` is pasted above for exactly that reason.

**Same failure mode as the article, one day later.** I asserted a spec's semantics from memory of
how the spec is usually summarised, inside a document arguing for verified attribution. The
`SOURCE_FIRST_WRITING_GATE.md` negative-capability pass added this morning would not have caught it,
because this was not a negative claim — it was a **positive claim about an external specification,
made without fetching the specification.** Logged as its own gap: *a claim about what a spec, RFC,
or another project's docs say requires the fetch in the same breath, exactly as
`feedback_live_source_or_silence` already requires for a person or a live surface.* A specification
is an external surface.

The original wording stays in the git history at `eb481e3`. Not force-pushed.

Rust `Result`/`panic!` was independently confirmed by Aethar at the source. **Go was not re-read by
any seat** — the reference to it above is maker-asserted and should be treated as unverified.
