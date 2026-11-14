import { Directive, effect, inject, input } from '@angular/core';
import { MatInput } from '@angular/material/input';

/**
 * Puts a `matInput` that has no form control (plain `[value]` + `(input)` bindings) into Material's
 * error state while `appFieldError` holds a message: red outline, `aria-invalid`, and the field's
 * `<mat-error>` shows. Pair it with `@if (message) { <mat-error>{{ message }}</mat-error> }`.
 * Inputs bound to a form control (`[formField]`) don't need it: the control drives the error state.
 */
@Directive({ selector: 'input[matInput][appFieldError]' })
export class FieldErrorDirective {
  /** The message to show under the field, or null / empty for no error. */
  readonly appFieldError = input<string | null | undefined>(null);

  readonly #input = inject(MatInput);

  constructor() {
    effect(() => {
      const hasError = !!this.appFieldError();
      if (this.#input.errorState === hasError) return;
      this.#input.errorState = hasError;
      this.#input.stateChanges.next();
    });
  }
}
