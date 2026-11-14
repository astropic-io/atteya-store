import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireRole } from '../auth/require-role.js';
import { parseConfirmPayment, ReturnStepError } from './return-staff-step.js';
import { runReturnStep, type ReturnStepResult } from './return-staff-transaction.js';

/**
 * Payment Received (admin and staff, ATS-303): Waiting for Payment → Approved, once the courier fee arrived by InstaPay. Stamps `paymentReceivedAt` / `paymentReceivedBy` and updates the order's `returns` entry (`runReturnStep`). No stock moves: Approve already took the new pieces.
 */
export const confirmReturnPayment = onCall(
  adminCallableOptions(),
  async (request): Promise<ReturnStepResult> => {
    const actor = await requireRole(request, 'staff');
    let input;
    try {
      input = parseConfirmPayment(request.data);
    } catch (error: unknown) {
      if (error instanceof ReturnStepError) throw new HttpsError(error.code, error.message);
      throw error;
    }
    return runReturnStep(getFirestore(), { step: 'confirm-payment', input }, actor);
  },
);
