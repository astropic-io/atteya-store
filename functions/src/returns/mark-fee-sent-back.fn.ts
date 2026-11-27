import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireExtra } from '../auth/require-role.js';
import { parseFeeSentBack, ReturnStepError } from './return-staff-step.js';
import { runFeeSentBack, type ReturnStepResult } from './return-staff-transaction.js';

/**
 * Fee Sent Back (admin only, checked on the server, ATS-307): records that the courier fee of a
 * Rejected or Cancelled request went back by InstaPay (amount, Sent to, optional reference). The
 * status stays as it is; the shopper gets the Fee Sent Back email (`sendReturnEmails`).
 */
export const markFeeSentBack = onCall(adminCallableOptions(), async (request): Promise<ReturnStepResult> => {
  const actor = await requireExtra(request, 'refunds');
  let input;
  try {
    input = parseFeeSentBack(request.data);
  } catch (error: unknown) {
    if (error instanceof ReturnStepError) throw new HttpsError(error.code, error.message);
    throw error;
  }
  return runFeeSentBack(getFirestore(), input, actor);
});
