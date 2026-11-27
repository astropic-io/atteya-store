import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input, OnInit, PLATFORM_ID, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { nextReturnStatuses, returnPaysFirst, returnStatusLabel } from '@core/config/returns';
import { AuthService } from '@core/services/auth/auth.service';
import { SeoService } from '@core/services/seo';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/ui/dialogs/confirm-dialog/confirm-dialog.component';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';
import { StatusBadgeComponent } from '@shared/ui/status-badge/status-badge.component';
import { AdminNavService } from '../../../layout/admin-nav.service';
import {
  ApproveWrongItemDialogComponent,
  type ApproveWrongItemDialogData,
  type ApproveWrongItemDialogResult,
} from '../dialogs/approve-wrong-item-dialog.component';
import {
  FeeSentBackDialogComponent,
  type FeeSentBackDialogData,
  type FeeSentBackDialogResult,
} from '../dialogs/fee-sent-back-dialog.component';
import {
  ReceiveReturnDialogComponent,
  type ReceiveReturnDialogData,
  type ReceiveReturnDialogResult,
} from '../dialogs/receive-return-dialog.component';
import {
  RefundSentDialogComponent,
  type RefundSentDialogData,
  type RefundSentDialogResult,
} from '../dialogs/refund-sent-dialog.component';
import {
  RejectReturnDialogComponent,
  type RejectReturnDialogData,
  type RejectReturnDialogResult,
} from '../dialogs/reject-return-dialog.component';
import { RETURN_STATUS_CONFIG, type ReturnStepResult } from '../models/return-admin.model';
import { ReturnsAdminService, type SentPieceChoice } from '../services/returns-admin.service';
import {
  customerWhatsappUrl,
  egp,
  feeBackLimit,
  feeBackLine,
  feeBackNeedsCheck,
  feeBackOwed,
  feeLine,
  notReturnedMessage,
  productIdsOfRequest,
  rejectStockLines,
  returnActionError,
  returnDate,
  returnHistory,
  returnItemViews,
  returnNextStep,
} from '../utils/return-admin.utils';

type ReturnAction = 'approve' | 'payment' | 'reject' | 'receive' | 'refund' | 'fee-back';

const DIALOG_WIDTH = '480px';

/**
 * One return or exchange request (ATS-293): refs, customer, items with live stock, money, the
 * shopper's note and InstaPay details, the staff history, and the step buttons (Approve, Reject,
 * Item Received, Refund Sent). Every step runs on the server in one transaction.
 */
@Component({
  selector: 'app-return-details-page',
  host: { class: 'block w-full @container' },
  imports: [
    NgOptimizedImage,
    RouterLink,
    MatButtonModule,
    MatProgressSpinnerModule,
    AppImageFallbackDirective,
    SharedIconModule,
    SkeletonComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './return-details.page.html',
})
export class ReturnDetailsPageComponent implements OnInit {
  readonly #returns = inject(ReturnsAdminService);
  readonly #seo = inject(SeoService);
  readonly #dialog = inject(MatDialog);
  readonly #snackbar = inject(SnackbarService);
  readonly #nav = inject(AdminNavService);
  readonly #browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #auth = inject(AuthService);

  /** From the `:requestId` route segment. */
  readonly requestId = input.required<string>();

  readonly statusConfig = RETURN_STATUS_CONFIG;
  readonly busy = signal<ReturnAction | null>(null);
  /** Admins, and staff with Refunds switched on in Settings → Team (ATS-368). */
  readonly canSendRefunds = computed(() => this.#auth.hasExtra('refunds'));

  readonly dataResource = resource({
    params: () => ({ id: this.requestId() }),
    loader: async ({ params }) => {
      if (!this.#browser) return null;
      const request = await this.#returns.getRequest(params.id);
      if (!request) return null;
      const [products, notes] = await Promise.all([
        this.#returns.loadProducts(productIdsOfRequest(request)),
        this.#returns.getStaffNotes(request.id),
      ]);
      return { request, products, notes };
    },
  });

  readonly request = computed(() => this.dataResource.value()?.request ?? null);

  readonly loadErrorMessage = computed((): string | null =>
    this.dataResource.error() == null
      ? null
      : "We couldn't load this request. Refresh the page to try again.",
  );

  readonly items = computed(() => {
    const data = this.dataResource.value();
    return data ? returnItemViews(data.request, data.products) : [];
  });

  readonly history = computed(() => {
    const data = this.dataResource.value();
    return data ? returnHistory(data.request, data.notes) : [];
  });

  readonly nextStep = computed(() => {
    const request = this.request();
    return request ? returnNextStep(request) : null;
  });

  readonly whatsappUrl = computed(() => {
    const request = this.request();
    return request ? customerWhatsappUrl(request) : null;
  });

  readonly money = computed(() => {
    const request = this.request();
    if (!request) return null;
    return {
      items: egp(request.itemsEgp),
      fee: feeLine(request),
      refund: request.hasRefund ? egp(request.refundEgp) : null,
      cash: request.cashAtDoorEgp > 0 ? egp(request.cashAtDoorEgp) : null,
      sent: request.refundSentEgp !== null ? egp(request.refundSentEgp) : null,
    };
  });

  readonly address = computed(() => {
    const c = this.request()?.customer;
    return c ? [c.line1, c.line2, c.city].filter((line): line is string => !!line) : [];
  });

  readonly notReturnedNote = computed(() => {
    const count = this.request()?.stockNotReturned ?? 0;
    return count > 0 ? notReturnedMessage(count) : null;
  });

  readonly createdAt = computed(() => returnDate(this.request()?.createdAt));

  /** The moves the request can make now (the server checks again). */
  readonly #moves = computed(() => {
    const request = this.request();
    return request ? nextReturnStatuses(request.status, request.hasRefund) : [];
  });
  /** Approve only from Requested: Waiting for Payment moves on with Payment Received (ATS-303). */
  readonly canApprove = computed(() => this.request()?.status === 'requested');
  readonly canConfirmPayment = computed(() => {
    const request = this.request();
    return request?.status === 'waiting-for-payment' && returnPaysFirst(request.feePaid, request.feeEgp);
  });
  readonly canReject = computed(() => this.#moves().includes('rejected'));
  readonly canReceive = computed(() => this.#moves().includes('received'));
  readonly canRefund = computed(() => this.#moves().includes('refund-sent') && this.canSendRefunds());
  readonly refundWaitsForAdmin = computed(
    () => this.#moves().includes('refund-sent') && !this.canSendRefunds(),
  );

  /** "Fee to send back: EGP 115", then "Fee sent back: EGP 115 · 14 Nov" (ATS-307). */
  readonly feeBack = computed(() => {
    const request = this.request();
    return request ? feeBackLine(request) : null;
  });
  readonly feeBackOwed = computed(() => {
    const request = this.request();
    return request ? feeBackOwed(request) : false;
  });
  readonly #feeBackLimit = computed(() => {
    const request = this.request();
    return request ? feeBackLimit(request) : 0;
  });
  /** The customer only says they paid: staff check InstaPay before sending it back. */
  readonly feeBackNeedsCheck = computed(() => {
    const request = this.request();
    return request ? feeBackNeedsCheck(request) : false;
  });
  /**
   * Admins and staff with Refunds on; other staff see the line but not the button (the server
   * refuses them too). Also on a
   * request that cancelled itself, in case the fee arrived just before the cancel.
   */
  readonly canSendFeeBack = computed(() => this.#feeBackLimit() > 0 && this.canSendRefunds());

  ngOnInit(): void {
    this.#seo.setPageMetadata({
      title: 'Return Request | Atteya Admin',
      description: 'One return or exchange request: items, stock, money and next step.',
      noindex: true,
    });
  }

  async approve(): Promise<void> {
    const request = this.request();
    if (!request || this.busy()) return;
    const wrong = request.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kind === 'wrong-item' && !item.sentProductId);
    let sent: readonly SentPieceChoice[] = [];
    if (wrong.length > 0) {
      const ref = this.#dialog.open<
        ApproveWrongItemDialogComponent,
        ApproveWrongItemDialogData,
        ApproveWrongItemDialogResult
      >(ApproveWrongItemDialogComponent, {
        data: {
          ref: request.ref,
          items: wrong.map(({ item, index }) => ({
            itemIndex: index,
            name: item.name || 'Item',
            detail: item.optionLabels.map((option) => `${option.label}: ${option.value}`).join(' · '),
          })),
        },
        width: DIALOG_WIDTH,
      });
      const result = await firstValueFrom(ref.afterClosed());
      if (!result) return;
      sent = result.sent;
    } else {
      const ok = await this.#ask({
        title: `Approve Request ${request.ref}?`,
        message:
          'New pieces for exchanges come out of stock now. Returned pieces go back only at Item Received.',
        confirmText: 'Approve',
        cancelText: 'Not Yet',
        theme: 'primary',
      });
      if (!ok) return;
    }
    const paysFirst = returnPaysFirst(request.feePaid, request.feeEgp);
    await this.#run(
      'approve',
      () => this.#returns.approve(request.id, sent),
      paysFirst
        ? `Request ${request.ref} approved. We asked the customer to pay the courier fee.`
        : `Request ${request.ref} approved.`,
    );
  }

  /** Payment Received (ATS-303): the courier fee arrived by InstaPay. */
  async confirmPayment(): Promise<void> {
    const request = this.request();
    if (!request || this.busy()) return;
    const ok = await this.#ask({
      title: `Did the ${egp(request.feeEgp)} arrive by InstaPay?`,
      message: `Request ${request.ref} moves to Approved and the customer gets an email that the courier is coming.`,
      confirmText: 'Payment Received',
      cancelText: 'Not Yet',
      theme: 'primary',
    });
    if (!ok) return;
    await this.#run(
      'payment',
      () => this.#returns.confirmPayment(request.id),
      `Payment saved. Send the courier for ${request.ref}.`,
    );
  }

  async reject(): Promise<void> {
    const request = this.request();
    if (!request || this.busy()) return;
    const ref = this.#dialog.open<
      RejectReturnDialogComponent,
      RejectReturnDialogData,
      RejectReturnDialogResult
    >(RejectReturnDialogComponent, {
      data: {
        ref: request.ref,
        // Approve took the new pieces, also while Waiting for Payment (ATS-303).
        approved: request.status === 'approved' || request.status === 'waiting-for-payment',
        stockLines: rejectStockLines(request, this.dataResource.value()?.products ?? new Map()),
        feeLabel: returnPaysFirst(request.feePaid, request.feeEgp) ? egp(request.feeEgp) : null,
        askFeePaid: request.status === 'waiting-for-payment',
        feeComesBack: request.status === 'approved' && request.paymentReceivedAt !== null,
      },
      width: DIALOG_WIDTH,
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    await this.#run(
      'reject',
      () => this.#returns.reject(request.id, result.reason, result.feeAlreadyPaid),
      `Request ${request.ref} rejected.`,
    );
  }

  async receive(): Promise<void> {
    const request = this.request();
    if (!request || this.busy()) return;
    const ref = this.#dialog.open<
      ReceiveReturnDialogComponent,
      ReceiveReturnDialogData,
      ReceiveReturnDialogResult
    >(ReceiveReturnDialogComponent, {
      data: {
        ref: request.ref,
        pieces: request.items.map((item, index) => ({
          itemIndex: index,
          name: item.name || 'Item',
          detail: item.autoGift ? 'Free gift' : item.askedLabel,
          quantity: item.quantity,
          damaged: item.kind === 'damaged',
          wrongItem: item.kind === 'wrong-item',
        })),
      },
      width: DIALOG_WIDTH,
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    await this.#run(
      'receive',
      () => this.#returns.receive(request.id, result.sellable),
      request.hasRefund ? `Items received. Send the refund next.` : `Items received. This exchange is done.`,
    );
  }

  async refundSent(): Promise<void> {
    const request = this.request();
    if (!request || this.busy()) return;
    const ref = this.#dialog.open<RefundSentDialogComponent, RefundSentDialogData, RefundSentDialogResult>(
      RefundSentDialogComponent,
      {
        data: {
          ref: request.ref,
          refundEgp: request.refundEgp,
          refundLabel: egp(request.refundEgp),
          itemsEgp: request.itemsEgp,
          refundTo: request.refundTo,
        },
        width: DIALOG_WIDTH,
      },
    );
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    await this.#run(
      'refund',
      () => this.#returns.refundSent(request.id, result.amountEgp, result.reference),
      `Refund saved. Request ${request.ref} is done.`,
    );
  }

  /** Fee Sent Back (admin only, ATS-307): the paid courier fee went back by InstaPay. */
  async feeSentBack(): Promise<void> {
    const request = this.request();
    const fee = this.#feeBackLimit();
    if (!request || this.busy() || fee <= 0) return;
    const ref = this.#dialog.open<FeeSentBackDialogComponent, FeeSentBackDialogData, FeeSentBackDialogResult>(
      FeeSentBackDialogComponent,
      {
        data: {
          ref: request.ref,
          feeEgp: fee,
          feeLabel: egp(fee),
          refundTo: request.refundTo,
          checkFirst: feeBackNeedsCheck(request) || (request.feeBackEgp ?? 0) === 0,
        },
        width: DIALOG_WIDTH,
      },
    );
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    await this.#run(
      'fee-back',
      () => this.#returns.feeSentBack(request.id, result.amountEgp, result.sentTo, result.reference),
      'Fee sent back saved. We emailed the customer.',
    );
  }

  async #run(action: ReturnAction, call: () => Promise<ReturnStepResult>, done: string): Promise<void> {
    this.busy.set(action);
    try {
      const result = await call();
      if (!result.changed) {
        this.#snackbar.info(`Already ${returnStatusLabel(result.status)}. Nothing changed.`);
      } else if (result.notReturned > 0) {
        this.#snackbar.info(`${done} ${notReturnedMessage(result.notReturned)}`, 'Close', 8000);
      } else {
        this.#snackbar.success(done);
      }
      this.dataResource.reload();
      this.#nav.refreshReturnsCount();
    } catch (error: unknown) {
      this.#snackbar.error(returnActionError(error));
      this.dataResource.reload();
    } finally {
      this.busy.set(null);
    }
  }

  async #ask(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.#dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data,
        width: '440px',
      },
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
