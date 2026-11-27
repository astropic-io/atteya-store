import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { STAFF_EXTRAS, type StaffExtra } from '@core/services/auth/staff-extras';
import { STAFF_EXTRA_COPY } from '../../utils/admin-role.utils';

export interface StaffExtrasDialogData {
  readonly email: string;
  readonly extras: readonly StaffExtra[];
}

/**
 * Settings → Team, Extra Access (ATS-368): switch Refunds, Delete Orders and Sales Money on or off
 * for one staff member. Closes with the extras to keep on, or nothing for Cancel. The server
 * (`setStaffExtras`) saves them and checks them on every action.
 */
@Component({
  selector: 'app-staff-extras-dialog',
  imports: [MatDialogModule, MatButtonModule, MatSlideToggleModule],
  template: `
    <h2 mat-dialog-title class="font-title-lg font-bold!">Extra Access for {{ data.email }}</h2>
    <mat-dialog-content>
      <p class="font-body-md pb-2">
        Staff can do everyday work. Switch on anything extra this person should also do.
      </p>
      <ul class="elements-start-col items-stretch! w-full">
        @for (extra of extras; track extra) {
          <li class="elements-between gap-4 py-3 border-b border-outline-variant last:border-b-0">
            <div class="elements-start-col items-start! gap-0.5">
              <span [id]="'staff-extra-' + extra" class="font-body-lg">{{ copy[extra].label }}</span>
              <span class="font-body-sm text-on-surface-variant">{{ copy[extra].hint }}</span>
            </div>
            <mat-slide-toggle
              [attr.aria-labelledby]="'staff-extra-' + extra"
              [checked]="isOn(extra)"
              (change)="toggle(extra, $event.checked)"
            />
          </li>
        }
      </ul>
      <p class="font-body-sm pt-3">Switching something off signs them out, so they sign in again.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="cancel()">Cancel</button>
      <button matButton="filled" type="button" (click)="save()">Save Access</button>
    </mat-dialog-actions>
  `,
})
export class StaffExtrasDialogComponent {
  readonly data = inject<StaffExtrasDialogData>(MAT_DIALOG_DATA);
  readonly #ref = inject<MatDialogRef<StaffExtrasDialogComponent, StaffExtra[]>>(MatDialogRef);

  readonly extras = STAFF_EXTRAS;
  readonly copy = STAFF_EXTRA_COPY;
  readonly #on = signal<readonly StaffExtra[]>(this.data.extras);

  isOn(extra: StaffExtra): boolean {
    return this.#on().includes(extra);
  }

  toggle(extra: StaffExtra, on: boolean): void {
    this.#on.update((list) =>
      on ? [...list.filter((item) => item !== extra), extra] : list.filter((item) => item !== extra),
    );
  }

  cancel(): void {
    this.#ref.close();
  }

  save(): void {
    this.#ref.close(STAFF_EXTRAS.filter((extra) => this.#on().includes(extra)));
  }
}
