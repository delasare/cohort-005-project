# Cadence

An online course platform where Learners buy courses and work through their lessons.

## Language

### People

**Learner**:
Someone who buys courses and works through their lessons.
_Avoid_: Student

**Admin**:
A Cadence staff member who runs the platform, including resolving Refund Requests.

### Refunds

**Purchase**:
A Learner's payment for one course.

**Refund Request**:
A Learner's ask to get their money back on a Purchase. It is Requested until an Admin approves or declines it, and a Purchase may have at most one.
_Avoid_: Refund (for the ask itself), Cancellation, Cancel my purchase, Reversal, Chargeback

**Refund**:
Money returned to a Learner when their Refund Request is approved; the Learner loses access to the course.
_Avoid_: Reversal, Chargeback

**Refund Amount**:
What a Learner gets back on a Refund: always the amount they actually paid for the Purchase, never the course's list price.

**Refund Window**:
The fourteen calendar days, counted from the day of the Purchase, during which a Refund Request may be made.

**Refund Eligibility**:
The full set of rules a Purchase must pass before a Refund Request may be made: inside the Refund Window, under two hours watched, under half the lessons completed, and not a claimed team seat.

**Chargeback**:
A payment dispute the cardholder raises through their bank. It is not a Refund Request and is not modelled in Cadence.
