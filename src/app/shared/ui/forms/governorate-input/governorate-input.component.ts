import { Component, computed, effect, input, model, signal, untracked } from '@angular/core';
import { FormField, form, validate } from '@angular/forms/signals';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { normalizeGovernorateText, searchGovernorates, type Governorate } from '@core/services/offers/engine';

/** Message shown when no governorate is picked (checkout and Account → Delivery Address). */
export const CHOOSE_GOVERNORATE_MESSAGE = 'Choose your governorate.';

/**
 * Egypt governorate picker (ATS-306): a text field that filters the governorates we deliver to by
 * English or Arabic name and common city names. Only a picked row (or text that is exactly a
 * governorate's name) sets `value`; anything else leaves it null and shows "Choose your governorate."
 * once the field is left or `showError` is set.
 */
@Component({
  selector: 'app-governorate-input',
  imports: [MatAutocompleteModule, MatFormFieldModule, MatInputModule, FormField],
  host: { class: 'block w-full' },
  template: `
    <mat-form-field appearance="outline" class="w-full">
      <mat-label>Governorate</mat-label>
      <input
        matInput
        [formField]="queryForm.query"
        [matAutocomplete]="governorateAuto"
        (input)="onInput($event)"
        autocomplete="address-level1"
        placeholder="Start typing your governorate"
      />
      <mat-autocomplete #governorateAuto="matAutocomplete" (optionSelected)="onSelected($event)">
        @for (governorate of filtered(); track governorate.id) {
          <mat-option [value]="governorate.name"
            >{{ governorate.name }} · {{ governorate.nameAr }}</mat-option
          >
        } @empty {
          @if (query()) {
            <mat-option disabled>No governorate matches</mat-option>
          }
        }
      </mat-autocomplete>
      @if (queryForm.query().invalid() && queryForm.query().touched()) {
        <mat-error>{{ errorMessage }}</mat-error>
      }
    </mat-form-field>
  `,
})
export class GovernorateInputComponent {
  /** Governorates the shopper can pick (the ones we deliver to). */
  readonly options = input.required<readonly Governorate[]>();
  /** The picked governorate id, or null. */
  readonly value = model<string | null>(null);
  /** Set by the page after a failed save or Place Order, so the error shows without a visit. */
  readonly showError = input(false);

  readonly errorMessage = CHOOSE_GOVERNORATE_MESSAGE;
  readonly #text = signal({ query: '' });
  readonly query = computed(() => this.#text().query);
  readonly queryForm = form(this.#text, (path) => {
    validate(path.query, () =>
      this.#picked() ? undefined : { kind: 'governorate', message: CHOOSE_GOVERNORATE_MESSAGE },
    );
  });
  readonly filtered = computed(() => searchGovernorates(this.options(), this.query()));
  readonly #picked = computed(() => {
    const id = this.value();
    return id ? (this.options().find((governorate) => governorate.id === id) ?? null) : null;
  });

  constructor() {
    // A value set from outside (saved address, switched governorate) shows its English name; one
    // no longer on the list (switched off) is cleared so it has to be picked again.
    effect(() => {
      const id = this.value();
      const picked = this.#picked();
      untracked(() => {
        if (id && !picked && this.options().length > 0) {
          this.value.set(null);
          return;
        }
        if (picked && this.query() !== picked.name) this.#text.set({ query: picked.name });
      });
    });
    effect(() => {
      if (this.showError()) untracked(() => this.queryForm.query().markAsTouched());
    });
  }

  onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.value.set(this.#exactMatch(text)?.id ?? null);
  }

  onSelected(event: MatAutocompleteSelectedEvent): void {
    const name = String(event.option.value ?? '');
    const governorate = this.options().find((option) => option.name === name) ?? null;
    this.#text.set({ query: governorate?.name ?? name });
    this.value.set(governorate?.id ?? null);
  }

  /** A governorate whose English or Arabic name is exactly the typed text. */
  #exactMatch(text: string): Governorate | null {
    const needle = normalizeGovernorateText(text);
    if (!needle) return null;
    return (
      this.options().find(
        (governorate) =>
          normalizeGovernorateText(governorate.name) === needle ||
          normalizeGovernorateText(governorate.nameAr) === needle,
      ) ?? null
    );
  }
}
