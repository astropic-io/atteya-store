import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireRole } from '../auth/require-role.js';
import { reopenOrder as reopen, type ReopenOrderResult } from './order-reopen.js';

/**
 * Reopen Order (ATS-325, admins and staff): puts an order cancelled by mistake back to the status
 * it had before the cancel, within 7 days. Stock, offer uses, stamps and `statusHistory` change in
 * one transaction (`reopenOrder`); the shopper gets the "back on" email from `sendOrderEmails`.
 */
export const reopenOrder = onCall(adminCallableOptions(), async (request): Promise<ReopenOrderResult> => {
  const actor = await requireRole(request, 'staff');
  return reopen(getFirestore(), parseOrderId(request.data), actor);
});

function parseOrderId(raw: unknown): string {
  const orderId =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)['orderId']
      : undefined;
  if (typeof orderId !== 'string' || orderId.length === 0 || orderId.length > 200 || orderId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Choose an order to reopen.');
  }
  return orderId;
}
