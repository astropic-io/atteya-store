import type { ReturnStatus } from '../store/returns.js';
import type { ReturnEmailRequest } from './return-email-model.js';

/**
 * The emails a return request can send (ATS-291, ATS-294). Each is sent at most once per request
 * (`returnEmails/{requestId}_{kind}` in the trigger).
 */
export type ReturnEmailKind =
  /** Staff alert: a shopper sent a return or exchange request. */
  | 'store-return-request'
  /** Shopper: "Request Sent". */
  | 'return-requested'
  /**
   * Shopper: "Request Approved" (Requested → Approved), or its pay version when the shopper pays
   * the courier fee by InstaPay first (Requested → Waiting for Payment, ATS-303).
   */
  | 'return-approved'
  /** Shopper: "Payment Received" (Waiting for Payment → Approved, ATS-303). */
  | 'return-payment-received'
  /** Shopper: "We Can't Take It Back" (Requested or Approved → Rejected). */
  | 'return-rejected'
  /** Shopper: "Items Received" (Approved → Received). */
  | 'return-received'
  /** Shopper: "Refund Sent" (Received → Refund Sent). */
  | 'return-refund-sent'
  /** Shopper: the courier fee is still to pay, 2 days after Approve (ATS-307). */
  | 'return-fee-reminder'
  /** Staff alert: still waiting for the courier fee, 2 days after Approve (ATS-307). */
  | 'store-return-fee-reminder'
  /** Shopper: the request cancelled itself, the fee didn't arrive in 5 days (ATS-307). */
  | 'return-auto-cancelled'
  /** Shopper: "Fee Sent Back", the paid courier fee went back by InstaPay (ATS-307). */
  | 'return-fee-sent-back';

/** What the choice of email reads from the request before and after a write. */
export type ReturnEmailState = Pick<ReturnEmailRequest, 'status'> &
  Partial<
    Pick<
      ReturnEmailRequest,
      'refundSentEgp' | 'feeReminderSent' | 'feeSentBack' | 'feeSentBackEgp' | 'cancelledBy'
    >
  >;

/** `returnEmails` document id: one per (request, email). */
export function returnClaimId(kind: ReturnEmailKind, request: Pick<ReturnEmailRequest, 'id'>): string {
  return `${request.id}_${kind}`;
}

/**
 * The shopper email each staff step sends, keyed by the new status, with the statuses it may come
 * from. Any other change (a step back, the same status written again, Cancelled) sends nothing.
 */
const STATUS_EMAILS: Partial<
  Record<ReturnStatus, { readonly kind: ReturnEmailKind; readonly from: readonly ReturnStatus[] }>
> = {
  'waiting-for-payment': { kind: 'return-approved', from: ['requested'] },
  approved: { kind: 'return-approved', from: ['requested'] },
  rejected: { kind: 'return-rejected', from: ['requested', 'waiting-for-payment', 'approved'] },
  received: { kind: 'return-received', from: ['approved'] },
  'refund-sent': { kind: 'return-refund-sent', from: ['received'] },
};

/**
 * A new request (created as Requested) sends the staff alert and the shopper's "Request Sent".
 * A staff step forward sends the matching shopper email (`STATUS_EMAILS`). A Refund Sent of
 * EGP 0 (the courier fee used up the refund) sends nothing: the Received email already said so.
 * ATS-307: the schedule's fee reminder sends the shopper and staff reminders, its automatic cancel
 * sends "was cancelled", and Fee Sent Back sends the shopper its email; the shopper's own Cancel
 * still sends nothing.
 */
export function returnEmailsForWrite(
  before: ReturnEmailState | null,
  after: (ReturnEmailState & Pick<ReturnEmailRequest, 'refundSentEgp'>) | null,
): ReturnEmailKind[] {
  if (!after) return [];
  if (before === null) {
    return after.status === 'requested' ? ['store-return-request', 'return-requested'] : [];
  }
  if (after.feeSentBack === true && before.feeSentBack !== true && (after.feeSentBackEgp ?? 0) > 0) {
    return ['return-fee-sent-back'];
  }
  if (
    before.status === 'waiting-for-payment' &&
    after.status === 'waiting-for-payment' &&
    after.feeReminderSent === true &&
    before.feeReminderSent !== true
  ) {
    return ['return-fee-reminder', 'store-return-fee-reminder'];
  }
  if (before.status === after.status) return [];
  if (
    before.status === 'waiting-for-payment' &&
    after.status === 'cancelled' &&
    after.cancelledBy === 'system'
  ) {
    return ['return-auto-cancelled'];
  }
  // Payment Received: Waiting for Payment → Approved sends its own email, not a second Approved.
  if (before.status === 'waiting-for-payment' && after.status === 'approved') {
    return ['return-payment-received'];
  }
  const step = STATUS_EMAILS[after.status];
  if (!step || !step.from.includes(before.status)) return [];
  if (step.kind === 'return-refund-sent' && after.refundSentEgp <= 0) return [];
  return [step.kind];
}
