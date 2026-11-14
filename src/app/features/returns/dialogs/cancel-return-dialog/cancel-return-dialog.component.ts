import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface CancelReturnDialogData {
  /**
   * "EGP 115" while Waiting for Payment: the dialog then asks whether the courier fee was already
   * sent (ATS-307). Null while Requested (nothing was paid yet).
   */
  readonly feeLabel: string | null;
}

/** Closes with the choice; Keep Request closes with nothing. */
export interface CancelReturnDialogResult {
  readonly feeAlreadyPaid: boolean;
}

/**
 * Cancel Request on the order page. While Waiting for Payment it has the checkbox
 * "I already sent the EGP 115 courier fee", so the fee is saved to send back (ATS-307).
 */
@Component({
  selector: 'app-cancel-return-dialog',
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title class="font-title-lg font-bold!">Cancel this request?</h2>
    <mat-dialog-content>
      <div class="elements-start-col gap-3 py-1">
        <p class="font-body-md opacity-85">
          We will stop your return or exchange. You can send a new request while the 14 days are open.
        </p>
        @if (data.feeLabel; as fee) {
          <mat-checkbox [checked]="feeAlreadyPaid()" (change)="feeAlreadyPaid.set($event.checked)">
            I already sent the {{ fee }} courier fee
          </mat-checkbox>
          @if (feeAlreadyPaid()) {
            <p class="font-body-md opacity-85">We'll send your {{ fee }} courier fee back by InstaPay.</p>
          }
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="gap-2 px-6 pb-4">
      <button matButton="text" type="button" [mat-dialog-close]="undefined">Keep Request</button>
      <button matButton="filled" theme="error" type="button" (click)="confirm()">Cancel Request</button>
    </mat-dialog-actions>
  `,
})
export class CancelReturnDialogComponent {
  readonly data = inject<CancelReturnDialogData>(MAT_DIALOG_DATA);
  readonly #ref = inject<MatDialogRef<CancelReturnDialogComponent, CancelReturnDialogResult>>(MatDialogRef);

  readonly feeAlreadyPaid = signal(false);

  confirm(): void {
    this.#ref.close({ feeAlreadyPaid: this.data.feeLabel !== null && this.feeAlreadyPaid() });
  }
}
