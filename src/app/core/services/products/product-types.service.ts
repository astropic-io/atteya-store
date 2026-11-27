import { isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, PLATFORM_ID, Service, signal } from '@angular/core';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { injectFirestore } from '@core/firebase';
import {
  PRODUCT_TYPES_DOC,
  resolveProductTypes,
  typeName,
  typePhrase,
  type ProductTypeEntry,
} from './product-types';

/**
 * The live product type list (ATS-388): `settings/productTypes`, or the 10 built-in types while
 * nothing is saved or the doc hasn't loaded (server render included). Admin pickers, the offer
 * editor and the product page wording all read it.
 */
@Service()
export class ProductTypesService {
  readonly #firestore = injectFirestore();
  readonly #platformId = inject(PLATFORM_ID);
  readonly #destroyRef = inject(DestroyRef);

  /** undefined until the first snapshot; null when no list is saved. */
  readonly #raw = signal<unknown>(undefined);

  constructor() {
    if (!isPlatformBrowser(this.#platformId)) return;
    const unsubscribe = onSnapshot(
      doc(this.#firestore, ...PRODUCT_TYPES_DOC),
      (snapshot) => this.#raw.set(snapshot.exists() ? snapshot.data() : null),
      () => this.#raw.set(null),
    );
    this.#destroyRef.onDestroy(unsubscribe);
  }

  /** True once the saved list (or its absence) is known. */
  readonly loaded = computed(() => this.#raw() !== undefined);

  /** Every type in the order staff set. */
  readonly types = computed(() => resolveProductTypes(this.#raw()));

  /** `{ id, label }` rows for dropdowns. */
  readonly options = computed(() => this.types().map((type) => ({ id: type.id, label: type.label })));

  label(id: string): string {
    return typeName(this.types(), id);
  }

  /** "this hoodie", "these socks". */
  phrase(id: string): string {
    return typePhrase(this.types(), id);
  }

  /** The category the product editor fills in for this type, or null when it has none. */
  defaultCategory(id: string): string | null {
    return this.types().find((type) => type.id === id)?.categoryId || null;
  }

  /** Saves the whole list in its new order (staff only; the `settings/{docId}` rule checks). */
  async save(types: readonly ProductTypeEntry[], uid: string | null): Promise<void> {
    await setDoc(doc(this.#firestore, ...PRODUCT_TYPES_DOC), {
      types: types.map((type) => ({
        id: type.id,
        label: type.label,
        phrase: type.phrase,
        categoryId: type.categoryId,
      })),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  }
}
