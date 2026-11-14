import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FEE_SENT_BACK_TEXT_MAX } from '@core/config/returns';

export interface FeeSentBackDialogData {
  readonly ref: string;
  /** The courier fee to send back, whole EGP: the most the server accepts. */
  readonly feeEgp: number;
  /** "EGP 115". */
  readonly feeLabel: string;
  /** The InstaPay number or address the customer gave for a refund, to start "Sent to" with. */
  readonly refundTo: string | null;
  /** Only the customer's word (or a request that cancelled itself): check InstaPay first. */
  readonly checkFirst: boolean;
}

export interface FeeSentBackDialogResult {
  readonly amountEgp: number;
  readonly sentTo: string;
  readonly reference: string | null;
}

/**
 * Fee Sent Back (admin only, ATS-307): records that the paid courier fee went back by InstaPay.
 * Staff send it in the InstaPay app; this only saves the amount, Sent to and an optional reference.
 */
@Component({
  selector: 'app-fee-sent-back-dialog',
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title class="font-title-lg font-bold!">Fee Sent Back for {{ data.ref }}</h2>
    <form (submit)="$event.preventDefault(); save()">
      <mat-dialog-content>
        <div class="return-dialog-fields">
          @if (data.checkFirst) {
            <p class="font-body-md opacity-85">
              Check the {{ data.feeLabel }} courier fee arrived in InstaPay before you send it back.
            </p>
          }
          <mat-form-field class="w-full" appearance="outline">
            <mat-label>Amount sent (EGP)</mat-label>
            <input
              matInput
              type="number"
              inputmode="numeric"
              min="1"
              [attr.max]="data.feeEgp"
              step="1"
              required
              [value]="amount()"
              (input)="amount.set($any($event.target).value)"
            />
            @if (amountValid()) {
              <mat-hint>The courier fee is {{ data.feeLabel }}.</mat-hint>
            } @else {
              <mat-hint>Write the amount in whole pounds, up to {{ data.feeLabel }}.</mat-hint>
            }
          </mat-form-field>
          <mat-form-field class="w-full" appearance="outline">
            <mat-label>Sent to</mat-label>
            <input
              matInput
              required
              dir="auto"
              [attr.maxlength]="textMax"
              [value]="sentTo()"
              (input)="sentTo.set($any($event.target).value)"
            />
            <mat-hint>The InstaPay number or address you sent it to.</mat-hint>
          </mat-form-field>
          <mat-form-field class="w-full" appearance="outline">
            <mat-label>Reference (optional)</mat-label>
            <input
              matInput
              [attr.maxlength]="textMax"
              [value]="reference()"
              (input)="reference.set($any($event.target).value)"
            />
            <mat-hint>The customer sees this in their email.</mat-hint>
          </mat-form-field>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions class="catalog-dialog-actions">
        <button matButton="text" type="button" [mat-dialog-close]="undefined">Not Yet</button>
        <button matButton="filled" type="submit" [disabled]="!canSave()">Fee Sent Back</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class FeeSentBackDialogComponent {
  readonly data = inject<FeeSentBackDialogData>(MAT_DIALOG_DATA);
  readonly #ref = inject<MatDialogRef<FeeSentBackDialogComponent, FeeSentBackDialogResult>>(MatDialogRef);

  readonly textMax = FEE_SENT_BACK_TEXT_MAX;
  readonly amount = signal(String(this.data.feeEgp));
  readonly sentTo = signal(this.data.refundTo ?? '');
  readonly reference = signal('');
  readonly #amountEgp = computed(() => Number(this.amount()));
  readonly amountValid = computed(() => {
    const value = this.#amountEgp();
    return Number.isInteger(value) && value >= 1 && value <= this.data.feeEgp;
  });
  readonly canSave = computed(() => {
    const to = this.sentTo().trim();
    return this.amountValid() && to.length > 0 && to.length <= FEE_SENT_BACK_TEXT_MAX;
  });

  save(): void {
    if (!this.canSave()) return;
    const reference = this.reference().trim().slice(0, FEE_SENT_BACK_TEXT_MAX);
    this.#ref.close({
      amountEgp: this.#amountEgp(),
      sentTo: this.sentTo().trim(),
      reference: reference || null,
    });
  }
}
