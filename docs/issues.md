# Reported issues

The loop this platform exists for: somebody reports something where they
live, it is checked before anybody else sees it, and once published the
people around them are told.

```
member submits → SUBMITTED → UNDER_REVIEW → VERIFIED → PUBLISHED → RESOLVED
                                          ↘ REJECTED (with a reason, shown to the reporter)
```

Nothing is public before `PUBLISHED`. That is enforced in one module, not
at each call site — see below.

---

## Why this is not an article with a flag

An article is written by staff and published because staff decided to. A
report is submitted by somebody not yet trusted, must be verified before it
is visible, carries a location that decides who hears about it, and can be
resolved later.

Folding them together would mean every article query carries *"and not an
unverified report from the public"*. The day somebody forgets that
condition, an unchecked accusation about a named official is published. So
they are separate tables with separate queries.

---

## Protecting the reporter

On a platform whose sectors include corruption, the identity of the person
who filed a report is the most dangerous thing here — more dangerous than
any password, because a password can be changed and a name cannot be
unlearned by the people it was reported to.

**`lib/issueVisibility.ts` holds the rules and imports nothing.** It is
pure so it can be tested exhaustively without a database, and
`tests/unit/issueVisibility.test.ts` reads as the questions an inquiry
would ask: could a stranger see this, could the accused, could it leak
before anybody checked it was true.

**`lib/issues.ts` makes every query go through those rules.** There is one
public selector and one projection function, and the projection names every
field it returns rather than spreading and deleting — so a column added to
the selector later is invisible until somebody writes it down.

| Guarantee | Where |
| --- | --- |
| Nothing unpublished is public | `listPublishedIssues` takes no status parameter |
| An anonymous report never carries its reporter outward, at any status | `publicReporter()` returns a marker, never a name |
| A forbidden report and a missing one look identical | `getIssueForViewer` returns null for both |
| A reporter can always follow their own report | `canViewUnpublished` |
| Holding every other permission does not imply `issue.verify` | asserted in the tests |

**The account link is kept.** A verifier has to be able to ask a follow-up
question, and a report nobody can go back to usually cannot be verified at
all. The residual risk is real and was accepted deliberately: if the
platform is seized, subpoenaed, or an administrator account is
compromised, that link identifies the reporter.

Two things follow from that, and both are now in place:

- **A second factor is required of anybody holding `issue.verify`**,
  enforced in `src/proxy.ts`. Either method will do — unlike for
  administrators, who must use an app. A verifier is often a volunteer on
  a phone in a district office, and demanding an authenticator app would
  push the work to whoever owns one rather than whoever should do it.
- **Rejected reports are deleted after ninety days**
  (`RETENTION.rejectedIssueDays`, overridable with
  `REJECTED_ISSUE_RETENTION_DAYS`). A rejected report is an unverified
  accusation still linked to the person who made it, and it will never be
  published — so every day it is kept is risk carried for no benefit.
  Deleted outright rather than anonymised: anonymising would keep the
  unsubstantiated claim about a named official and discard only the
  reporter, which is the wrong half. Ninety days leaves room to appeal or
  supply what was missing, and keeps a pattern of rejections from one
  account visible to moderation for a season.

**Push notifications never name the reporter**, anonymous or not. A
notification lands on a lock screen anybody standing nearby can read, and
in a district where the subject and the author live on the same street a
byline there is a safety failure.

**Photographs are stripped of EXIF** by the `sharp` re-encode every upload
goes through. This matters more here than anywhere else on the site: a
photograph of something somebody was not supposed to photograph usually
records the coordinates of where they stood to take it. Verified against
real bytes — a JPEG with GPS EXIF goes in, a WebP with none comes out.

**Evidence ownership is checked server-side.** The media ids come from the
browser, so without it a report could carry somebody else's photograph,
including evidence from another reporter's unpublished report.

---

## Verify and publish are separate permissions

| Permission | What it means |
| --- | --- |
| `issue.submit` | Raise a report. Every member has it. |
| `issue.verify` | Read the queue, ask the reporter questions, mark verified or rejected. **Also means seeing who filed every anonymous report.** |
| `issue.publish` | Make a verified report public, which alerts the district. |
| `issue.resolve` | Record that the thing was dealt with. |

Keeping verify and publish apart is what stops one account — mistaken,
pressured or compromised — putting an unchecked accusation in front of a
whole district on its own. An administrator can build a role with one and
not the other at `/dashboard/roles`.

`issue.verify` is the dangerous one, and the queue page says so at the top
rather than leaving somebody to discover it.

---

## Alerting

`alertDistrictOfIssue()` runs when a report is published. It:

- re-checks the status itself rather than trusting the caller, because a
  notification cannot be recalled;
- writes durable `Notification` rows first and pushes second, so a failed
  push does not cost somebody the alert;
- excludes the reporter, who knows;
- leans on the unique index `(userId, type, issueId)` so publishing,
  correcting and resolving the same report does not tell anybody twice;
- caps one pass at 2,000 people. Kathmandu district alone could be far
  more, and a queue is the honest answer for that — this platform does not
  have one yet and should not pretend to.

Members set their district on the account page. It is **optional and must
stay optional**: somebody reporting on their own district may not want to
be listed as living in it.

---

## Geography

Nepal's seven provinces and seventy-seven districts are reference data in
`lib/nepal.ts`, seeded by `npm run seed`, with English and Nepali names.
`tests/unit/nepal.test.ts` asserts the counts and the distribution,
including that Rukum East/West and Nawalpur/Parasi stay in their separate
provinces — the districts split when federalism came in, where collapsing
either pair would file reports under the wrong government.

**The 753 local levels are modelled but not seeded.** A half-remembered
list is worse than none, because it looks authoritative and quietly
misfiles reports. They should come from the Ministry of Federal Affairs'
published list. District is the finest granularity anything depends on
today.

---

## References

`NP-XXXX-XXXX`, from a CSPRNG, deliberately not sequential. A running
number would publish how many reports the platform has received and would
tell the subject of report 41 roughly when it was filed — which in a small
district is close to identifying the reporter. The alphabet drops the
characters misread aloud or in handwriting: no O/0, I/1, S/5, B/8, Z/2, so
it survives being read down a phone to a ward office.

---

## Not done yet

- **A queue for large-district alerting.** 2,000 per pass is a cap, not a
  solution.
- **Local levels**, as above.
- **Government access.** Deliberately nothing: any collaboration should
  see what the public sees, and anything more should require a court order
  and a policy to point at.
