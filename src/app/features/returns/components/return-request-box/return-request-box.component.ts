import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import {
  readReturnOrderLines,
  returnPaymentWhatsappText,
  returnPhotosWhatsappText,
  returnStatusLabel,
  type ReturnStatus,
  type ReturnSummary,
} from '@core/config/returns';
import { STORE_INFO, whatsappChatUrl } from '@core/config/store-info';
import type { OrderDoc } from '@core/services/orders/order.schema';
import { shortOrderRef } from '@core/services/orders/order-ref';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { callableMessage } from '@shared/utils/firebase/firebase-errors';
import { normalizeImageKitPath } from '@shared/utils/image';
import { formatMoney } from '@shared/utils/money';
import {
  CancelReturnDialogComponent,
  type CancelReturnDialogData,
  type CancelReturnDialogResult,
} from '../../dialogs/cancel-return-dialog/cancel-return-dialog.component';
import { ReturnsService } from '../../services/returns.service';
import { savedReturnRequest } from '../../utils/return-memory';
import { lineDetails, readRequestDetails } from '../../utils/return-request.utils';

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * One return or exchange request on the order page (ATS-292): ref, status steps, the items and
 * what was asked, the refund, and **Cancel Request** / **Send Photos on WhatsApp** while they
 * apply. Reads the order's live `returns` summary, so it changes as staff move the request.
 */
@Component({
  selector: 'app-return-request-box',
  host: { class: 'block w-full' },
  imports: [
    NgOptimizedImage,
    AppImageFallbackDirective,
    MatButtonModule,
    MatProgressSpinnerModule,
    SharedIconModule,
  ],
  templateUrl: './return-request-box.component.html',
})
export class ReturnRequestBoxComponent {
  readonly request = input.required<ReturnSummary>();
  readonly order = input.required<OrderDoc>();
  readonly orderId = input.required<string>();
  /** A guest order's view key; null for the signed-in owner. */
  readonly viewKey = input<string | null>(null);
  /** "24 Nov" while a new request can still be sent; null once the window closed. */
  readonly newUntil = input<string | null>(null);

  readonly #returns = inject(ReturnsService);
  readonly #dialog = inject(MatDialog);
  readonly #snackbar = inject(SnackbarService);

  readonly isCancelling = signal(false);

  readonly statusLabel = computed(() => returnStatusLabel(this.request().status));
  readonly done = computed(() => ['rejected', 'cancelled'].includes(this.request().status));

  /** What the order summary says about this request, else what this browser sent. */
  readonly #details = computed(() => {
    const fromOrder = readRequestDetails(this.order().returns, this.request().id);
    const saved = savedReturnRequest(this.request().id);
    return {
      asked: { ...saved.asked, ...fromOrder.asked },
      storeFault: fromOrder.storeFault ?? saved.storeFault ?? false,
      refundEgp: fromOrder.refundEgp ?? saved.refundEgp ?? null,
      rejectReason: fromOrder.rejectReason ?? null,
      payFeeEgp: fromOrder.payFeeEgp ?? null,
      feeBackEgp: fromOrder.feeBackEgp ?? null,
      feeSentBackEgp: fromOrder.feeSentBackEgp ?? null,
      feeSentBackAtMs: fromOrder.feeSentBackAtMs ?? null,
      autoCancelled: fromOrder.autoCancelled ?? false,
    };
  });

  /**
   * A paid courier fee coming back (ATS-307): "We'll send your EGP 115 courier fee back by
   * InstaPay." until staff record it, then "Fee sent back: EGP 115 · 14 Nov".
   */
  readonly feeBack = computed((): string | null => {
    const details = this.#details();
    if (details.feeSentBackEgp !== null) {
      const amount = formatMoney(details.feeSentBackEgp, 'EGP', 0);
      const day =
        details.feeSentBackAtMs === null ? '' : SHORT_DATE.format(new Date(details.feeSentBackAtMs));
      return day ? `Fee sent back: ${amount} · ${day}` : `Fee sent back: ${amount}`;
    }
    return details.feeBackEgp !== null
      ? `We'll send your ${formatMoney(details.feeBackEgp, 'EGP', 0)} courier fee back by InstaPay.`
      : null;
  });

  /** The courier fee is paid by InstaPay before the courier comes (ATS-303). */
  readonly #paysFirst = computed(() => this.#details().payFeeEgp !== null);

  /**
   * Requested → (Waiting for Payment when the shopper pays the courier fee first) → Approved →
   * Received (→ Refund Sent when there is a refund).
   */
  readonly steps = computed(() => {
    const request = this.request();
    const all: ReturnStatus[] = this.#paysFirst()
      ? ['requested', 'waiting-for-payment', 'approved', 'received']
      : ['requested', 'approved', 'received'];
    if (request.hasRefund) all.push('refund-sent');
    const reached = all.indexOf(request.status);
    return all.map((status, index) => ({ status, label: returnStatusLabel(status), done: index <= reached }));
  });

  readonly items = computed(() => {
    const lines = readReturnOrderLines(this.order().pricing.lines);
    const asked = this.#details().asked;
    return this.request().items.map((item, index) => {
      const line = lines[item.lineIndex];
      const imagePath = line?.imagePath ?? null;
      const what = item.autoGift
        ? 'Free gift · goes back with it'
        : (asked[String(item.lineIndex)] ?? (item.refund ? 'Refund' : 'Exchange'));
      return {
        key: `${index}:${item.lineIndex}`,
        name: line?.name || 'Item',
        details: line ? lineDetails(line.optionLabels) : '',
        what: `${what} · ×${item.quantity}`,
        imagePath,
        imageSrc: imagePath ? normalizeImageKitPath(imagePath) : '',
      };
    });
  });

  /** Waiting for Payment: how to pay the courier fee, and the prewritten WhatsApp message. */
  readonly pay = computed(() => {
    const request = this.request();
    const fee = this.#details().payFeeEgp;
    if (request.status !== 'waiting-for-payment' || fee === null) return null;
    const amount = formatMoney(fee, 'EGP', 0);
    const info = STORE_INFO.payments.instapay;
    const to = [info.address.trim(), info.number.trim()].filter(Boolean);
    const hasDetails = to.length > 0;
    // Without InstaPay details there is nothing to pay to yet: ask for them, never "I paid".
    const whatsappUrl = hasDetails
      ? whatsappChatUrl(
          STORE_INFO.contact.whatsapp,
          returnPaymentWhatsappText(request.ref, shortOrderRef(this.orderId()), fee),
        )
      : whatsappChatUrl(STORE_INFO.contact.whatsapp);
    return {
      whatsappUrl,
      buttonLabel: hasDetails ? 'Send Screenshot on WhatsApp' : 'Message Us on WhatsApp',
      steps: [
        {
          title: `Send ${amount} by InstaPay`,
          note:
            to.length > 0
              ? `To ${to.join(' or ')}`
              : whatsappUrl
                ? "We'll send you the InstaPay details on WhatsApp."
                : "We'll send you the InstaPay details.",
          amount,
        },
        {
          title: whatsappUrl ? 'Send the screenshot on WhatsApp' : 'Send us the screenshot',
          note: 'With your request number',
          amount: null,
        },
        {
          title: 'We send the courier',
          note: 'To your delivery address, once your payment arrives.',
          amount: null,
        },
      ],
    };
  });

  /** The shopper can cancel while Requested or Waiting for Payment. */
  readonly canCancel = computed(() => ['requested', 'waiting-for-payment'].includes(this.request().status));

  readonly refundLabel = computed(() =>
    this.#paysFirst() ? 'Your refund' : 'Your refund after the courier fee',
  );

  readonly refund = computed(() => {
    const amount = this.#details().refundEgp;
    // EGP 0 (the courier fee took it all) is never shown as a refund on its way.
    return amount !== null && amount > 0 && this.request().hasRefund ? formatMoney(amount, 'EGP', 0) : null;
  });

  /** One line about where the request is. */
  readonly message = computed(() => {
    const request = this.request();
    const refund = this.refund();
    switch (request.status) {
      case 'requested':
        return this.#paysFirst()
          ? "We're looking at your request. Once we approve it, you pay the courier fee by InstaPay."
          : "We're looking at your request and will message you on WhatsApp to arrange the courier.";
      case 'waiting-for-payment':
        return "We approved your request. Please send the courier fee by InstaPay, and we'll send the courier once it arrives.";
      case 'approved':
        return 'Our courier will come to your delivery address to collect the items.';
      case 'received':
        if (!request.hasRefund) return 'We got your items. All done.';
        return refund
          ? `We got your items. Your refund of ${refund} is on its way by InstaPay.`
          : 'We got your items. Your refund is on its way by InstaPay.';
      case 'refund-sent':
        return refund
          ? `${refund} sent by InstaPay. All done.`
          : 'Your refund was sent by InstaPay. All done.';
      case 'rejected':
        return '';
      case 'cancelled': {
        const until = this.newUntil();
        const what = this.#details().autoCancelled
          ? "We cancelled this request because the courier fee didn't arrive in time."
          : 'You cancelled this request.';
        return until ? `${what} You can send a new one until ${until}.` : what;
      }
    }
  });

  readonly rejectReason = computed(() =>
    this.request().status === 'rejected' ? this.#details().rejectReason : null,
  );

  readonly whatsappUrl = whatsappChatUrl(STORE_INFO.contact.whatsapp);

  readonly photosUrl = computed(() => {
    const request = this.request();
    if (
      !this.#details().storeFault ||
      !['requested', 'waiting-for-payment', 'approved'].includes(request.status)
    )
      return null;
    return whatsappChatUrl(
      STORE_INFO.contact.whatsapp,
      returnPhotosWhatsappText(request.ref, shortOrderRef(this.orderId())),
    );
  });

  async cancel(): Promise<void> {
    if (this.isCancelling()) return;
    const fee = this.#details().payFeeEgp;
    const ref = this.#dialog.open<
      CancelReturnDialogComponent,
      CancelReturnDialogData,
      CancelReturnDialogResult
    >(CancelReturnDialogComponent, {
      data: {
        feeLabel:
          this.request().status === 'waiting-for-payment' && fee !== null ? formatMoney(fee, 'EGP', 0) : null,
      },
    });
    const choice = await firstValueFrom(ref.afterClosed());
    if (!choice) return;
    this.isCancelling.set(true);
    try {
      await this.#returns.cancelReturnRequest(this.request().id, this.viewKey(), choice.feeAlreadyPaid);
      this.#snackbar.success('Request cancelled.');
    } catch (error: unknown) {
      this.#snackbar.error(callableMessage(error) ?? "We couldn't cancel your request. Please try again.");
    } finally {
      this.isCancelling.set(false);
    }
  }
}
