# A Purchase gets at most one Refund Request

A Purchase may have at most one Refund Request, so once an Admin declines it the Student cannot ask again. We considered allowing a new Refund Request after a decline (with only one waiting at a time), but chose finality so that a decline closes the matter rather than starting a negotiation, and so that Refund Eligibility can't be retried until an Admin gives in.
