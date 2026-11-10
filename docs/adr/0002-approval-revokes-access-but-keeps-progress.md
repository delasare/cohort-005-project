# Approving a Refund Request revokes access but keeps progress

A learner loses access to a course at the moment an Admin approves their Refund Request. They don't lose it when they ask, and they don't lose it when the money is confirmed sent. Their enrollment, lesson progress, watch history and quiz attempts are kept rather than deleted. Revoking at the request would punish learners whose request is declined. Waiting for the money ties access to a payment flow that may fail or lag, even though the decision itself is already final. Keeping the progress preserves the watch history that justified the decision if it is ever disputed, and lets a learner who buys again carry on where they left off.

## Consequences

- Access is no longer just "an enrollment exists": an enrollment whose purchase has an Approved Refund Request grants no access, so access resolution must check refunds too.
- An Open Refund Request changes nothing; a learner can keep watching while they wait, so the Admin sees live progress, not progress as it was when they asked.
- Approving a team-licence purchase voids its unredeemed coupons, so no one can claim a seat that has been paid back.
- Buying the course again creates a new purchase, which restores access and may have its own Refund Request; watch time carries over, so the eligibility rules still apply to it.
