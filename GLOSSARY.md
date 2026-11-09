# Cadence

An online course platform where Students buy courses and work through their lessons.

## Language

### People

**Student**:
Someone who buys courses and works through their lessons.
_Avoid_: Learner

**Admin**:
A Cadence staff member who runs the platform, including resolving Refund Requests.

### Refunds

**Purchase**:
A payment for a course: either a Student buying it for themselves, or a Team Purchase.

**Refund Request**:
A Student's ask to get their money back on a Purchase. It is Requested until an Admin approves or declines it, and a Purchase may have at most one.
_Avoid_: Refund (for the ask itself), Cancellation, Cancel my purchase, Reversal, Chargeback

**Refund**:
Money returned to a Student when their Refund Request is approved; the Student loses access to the course.
_Avoid_: Reversal, Chargeback

**Refund Amount**:
What a Student gets back on a Refund: always the amount they actually paid for the Purchase, never the course's list price.

**Refund Window**:
The fourteen calendar days, counted from the day of the Purchase, during which a Refund Request may be made.

**Refund Eligibility**:
The full set of rules a Purchase must pass before a Refund Request may be made: inside the Refund Window, under two hours watched, under half the lessons completed, and not a Team Purchase.

**Chargeback**:
A payment dispute the cardholder raises through their bank. It is not a Refund Request and is not modelled in Cadence.

### Teams

**Team**:
The account a Team Manager buys Seats through. Claiming one of its Seats does not make a Student part of the Team.
_Avoid_: Team member (for a Student holding a Seat)

**Team Manager**:
The person who makes Team Purchases and hands out their Seat Codes.
_Avoid_: Team Admin

**Team Purchase**:
A Purchase of one or more Seats on a course, made by a Team Manager.

**Seat**:
One prepaid place on one course, bought in a Team Purchase.
_Avoid_: Coupon

**Seat Code**:
The code, shared as a link, that lets one Student claim a Seat.
_Avoid_: Coupon code

**Claim**:
What a Student does with a Seat Code to take the Seat and gain access to its course. Each Seat can be claimed once.
_Avoid_: Redeem
