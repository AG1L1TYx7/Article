# Membership and donations

Collected by bank transfer and confirmed by hand. There is no payment
gateway, and that is a decision rather than a gap.

```
somebody pledges → PENDING → (treasurer sees the money) → CONFIRMED
                           ↘ FAILED (never arrived)        ↘ REFUNDED
```

---

## ⚠️ Before switching this on

**Code cannot make the collection lawful.** In Nepal this generally
requires:

- registration under the Associations Registration Act (District
  Administration Office);
- affiliation with the **Social Welfare Council**;
- **separate SWC approval for foreign contributions** — which for a
  platform built and supported by Nepalis abroad is likely to be a large
  share of what comes in;
- a PAN, receipts, and the bookkeeping that follows from taking money.

The switch on the settings page says this too. Please settle it with
somebody who does NGO registration before turning it on.

---

## Why no gateway

eSewa, Khalti and Stripe all need a merchant agreement, which needs a
registered organisation, which is the thing that is not settled yet. Bank
transfer needs none of that, costs nothing per transaction, and keeps this
platform entirely outside PCI scope rather than merely compliant with it.

A gateway slots in behind `Contribution.provider` later without changing
anything else here.

---

## Money is handled differently from everything else

**Amounts are integers, in paisa.** Never a float, never a decimal column
read into a JavaScript number. `0.1 + 0.2` is not `0.3` in binary floating
point, and a platform that collects donations and cannot add them up is
finished before anybody audits it — silently, because the totals look
plausible until somebody reconciles them against a statement.

`lib/money.ts` is pure and exhaustively tested: parsing what people
actually type ("Rs 500", "1,500", "500.50"), refusing what it would have
to guess at, South Asian digit grouping (`Rs 1,00,000`, not `Rs 100,000`),
and calendar-correct membership periods (31 January plus one month is 28
February, or the 29th in a leap year).

**No card details, anywhere.** The schema holds a provider name and the
reference that provider gave back. Nothing else.

**Records are permanent.** A refund is a status, never a deletion and
never a negative row — the original keeps its amount and its date, because
that is what happened. A donor closing their account unlinks the row
rather than removing it: an organisation has to account for money it
received long after the people involved have moved on.

---

## Nothing is money until a human says so

A pledge is text somebody typed into a form. Only a person holding
`contribution.confirm`, looking at a bank statement, moves it to
CONFIRMED — and **only CONFIRMED counts towards any published total.**
Publishing pledges as "raised" would be a claim the organisation cannot
substantiate.

Confirming twice is refused, so two treasurers working the same list
cannot inflate a total.

| Permission | Who should hold it |
| --- | --- |
| `contribution.view` | Whoever keeps the books. A donor list is a list of who funds this work. |
| `contribution.confirm` | The treasurer. This is what moves money in the records. |
| `membership.manage` | Administrators. Sets rates and the bank details. |

`membership.manage` is the dangerous one: whoever holds it can redirect
every donation to an account of their choosing. Every change is
audit-logged **with the account number**, so a change can be seen
afterwards rather than merely suspected.

---

## The two-step pledge

The form records intent and returns a reference; only then are the bank
details shown, with that reference beside them.

Showing the details first would leave a treasurer facing a statement of
unattributed deposits and a contributor with no way to prove theirs
arrived. The reference exists so a line on a bank statement can be matched
to a person — it is the whole mechanism, which is why it is the largest
thing on the screen once it exists.

`SUP-XXXX-XXXX`, from a CSPRNG, with O/0, I/1, S/5, B/8 and Z/2 left out
so it survives being read down a phone or written on a deposit slip.

---

## What membership buys

Recognition, and nothing else. Everything on this platform stays open to
everybody, including the people least able to pay — who are often the ones
with most to report. The support page says so plainly, because somebody
paying is entitled to know that is deliberate rather than unfinished.

---

## Anonymity

"Give without my name" stores **no name at all**, rather than storing one
and hiding it. There is then nothing to leak and nothing to erase.

The public supporters list is **off by default** and shows names only,
never amounts. A public ranking of who gave how much says more about
people's means than they agreed to share; and a list of who funds a
corruption platform is a list of people who can be leaned on.

---

## Not done yet

- **Receipts.** Nothing is emailed when a contribution is confirmed.
- **Membership tiers** can only be created directly in the database; there
  is no admin screen for them yet.
- **Lapse handling.** Nothing tells a member their year is ending, and
  nothing marks a membership expired.
- **Reconciliation tooling.** No export, no statement import — a treasurer
  matches by eye against the reference.
