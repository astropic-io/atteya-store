import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  MAX_TYPE_LABEL,
  MAX_TYPE_PHRASE,
  newTypeId,
  suggestTypePhrase,
  type ProductTypeEntry,
} from '@core/services/products/product-types';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { ENGLISH_NAME_MESSAGE, hasEnglishLetterOrDigit } from '../../utils/catalog-manager.utils';

export interface TypeCategoryOption {
  readonly id: string;
  /** "Apparel › Hoodies". */
  readonly label: string;
}

export interface TypeDialogData {
  /** Null = Add Type. */
  readonly type: ProductTypeEntry | null;
  /** Every type, so a new name gets an unused id and no two types share a name. */
  readonly types: readonly ProductTypeEntry[];
  /** Ids a new type can't take: every listed type's and every deleted one's. */
  readonly takenIds: readonly string[];
  readonly categories: readonly TypeCategoryOption[];
}

/** The type to save, or `'delete'` when Delete was pressed in Edit. */
export type TypeDialogResult = ProductTypeEntry | 'delete';

/**
 * Add or edit one product type (ATS-388): Name, how the product page names one ("this hoodie"),
 * and the category the product editor fills in. The Types tab saves the list.
 */
@Component({
  selector: 'app-type-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    SharedIconModule,
  ],
  templateUrl: './type-dialog.component.html',
})
export class TypeDialogComponent {
  readonly #data = inject<TypeDialogData>(MAT_DIALOG_DATA);
  readonly #ref = inject<MatDialogRef<TypeDialogComponent, TypeDialogResult>>(MatDialogRef);

  readonly maxName = MAX_TYPE_LABEL;
  readonly maxPhrase = MAX_TYPE_PHRASE;
  readonly isNew = this.#data.type === null;
  readonly title = this.isNew ? 'Add Type' : `Edit ${this.#data.type?.label ?? 'Type'}`;
  readonly saveLabel = this.isNew ? 'Add Type' : 'Save Changes';
  readonly categories = this.#data.categories;

  readonly name = signal(this.#data.type?.label ?? '');
  readonly categoryId = signal(this.#data.type?.categoryId ?? '');
  /** What staff typed; empty on a new type means "use the suggestion". */
  readonly #typedPhrase = signal(this.#data.type?.phrase ?? '');
  readonly #phraseTouched = signal(!this.isNew);
  readonly phrase = computed(() =>
    this.#phraseTouched() ? this.#typedPhrase() : suggestTypePhrase(this.name()),
  );
  readonly error = signal('');

  /** "Free socks with this hoodie": the phrase as shoppers read it. */
  readonly example = computed(() => {
    const phrase = this.phrase().trim();
    return phrase ? `Free socks with ${phrase}` : '';
  });

  textFrom(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  setPhrase(value: string): void {
    this.#phraseTouched.set(true);
    this.#typedPhrase.set(value);
    this.error.set('');
  }

  requestDelete(): void {
    this.#ref.close('delete');
  }

  save(): void {
    const label = this.name().replace(/\s+/g, ' ').trim();
    const phrase = this.phrase().replace(/\s+/g, ' ').trim().toLowerCase();
    if (!label) {
      this.error.set('Enter a name for the type.');
      return;
    }
    if (this.isNew && !hasEnglishLetterOrDigit(label)) {
      this.error.set(ENGLISH_NAME_MESSAGE);
      return;
    }
    const others = this.#data.types.filter((type) => type.id !== this.#data.type?.id);
    if (others.some((type) => type.label.toLowerCase() === label.toLowerCase())) {
      this.error.set(`There is already a type called ${label}.`);
      return;
    }
    if (!phrase) {
      this.error.set('Say how the product page names one, for example "this hoodie".');
      return;
    }
    this.#ref.close({
      id: this.#data.type?.id ?? newTypeId(label, this.#data.takenIds),
      label,
      phrase,
      categoryId: this.categoryId(),
    });
  }
}
