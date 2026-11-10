# A Declined Refund Request is final

A Purchase may have at most one Refund Request, so once an Admin declines it the Student cannot ask again, even though they are shown a Decline Reason. We considered allowing a new Refund Request after a decline (with only one Open at a time), but chose finality so that a Decline Reason closes the matter rather than starting a negotiation, and so that Refund Eligibility can't be retried until an Admin gives in.
