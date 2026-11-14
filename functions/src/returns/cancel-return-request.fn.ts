import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions, requireAppCheck } from '../auth/callable-options.js';
import { isOrderShopper } from './return-access.js';
import { runCancelReturn } from './return-cancel.js';

export interface CancelReturnRequestResponse {
  readonly requestId: string;
  readonly status: 'cancelled';
  /** False when the request was already cancelled. */
  readonly changed: boolean;
}

const NOT_FOUND = "We couldn't find that request. Check the link in your order email.";

/**
 * The shopper cancels their own return or exchange request while it is still Requested
 * (ATS-291) or Waiting for Payment (ATS-303). Same owner check as `requestReturn` (uid, or the
 * order's `viewKey`). `feeAlreadyPaid` (Waiting for Payment only, ATS-307) saves the courier fee
 * to send back. The transaction (`runCancelReturn`) is shared with the automatic cancel: from
 * Waiting for Payment it moves the `rejectStock` saved at Approve once, like staff's Reject.
 * Sends nothing.
 */
export const cancelReturnRequest = onCall(
  adminCallableOptions(),
  async (request): Promise<CancelReturnRequestResponse> => {
    requireAppCheck(request);
    const data = isRecord(request.data) ? request.data : {};
    const requestId = data['requestId'];
    const viewKeyRaw = data['viewKey'];
    const viewKey = typeof viewKeyRaw === 'string' && viewKeyRaw.length > 0 ? viewKeyRaw : null;
    const feeRaw = data['feeAlreadyPaid'];
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(requestId)) {
      throw new HttpsError('invalid-argument', NOT_FOUND);
    }
    if (feeRaw !== undefined && typeof feeRaw !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Please try again.');
    }
    const changed = await runCancelReturn(getFirestore(), requestId, {
      by: 'shopper',
      feeAlreadyPaid: feeRaw === true,
      updatedBy: request.auth?.uid ?? 'shopper',
      check: (_saved, order) => {
        if (!order || !isOrderShopper(order, request, viewKey)) throw new HttpsError('not-found', NOT_FOUND);
        return true;
      },
    });
    return { requestId, status: 'cancelled', changed };
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
