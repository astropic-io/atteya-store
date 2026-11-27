import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, PLATFORM_ID, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import type { ProductTypeEntry } from '@core/services/products/product-types';
import { ProductTypesService } from '@core/services/products/product-types.service';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/ui/dialogs/confirm-dialog/confirm-dialog.component';
import { SharedIconModule } from '@shared/ui/mat-icon';
import {
  DeleteBlockedDialogComponent,
  type DeleteBlockedDialogData,
} from '../../dialogs/delete-blocked-dialog/delete-blocked-dialog.component';
import {
  TypeDialogComponent,
  type TypeCategoryOption,
  type TypeDialogData,
  type TypeDialogResult,
} from '../../dialogs/type-dialog/type-dialog.component';
import { CatalogAdminService } from '../../services/catalog-admin.service';
import {
  buildCategoryTree,
  CATALOG_DIALOG_CONFIG,
  moveWithinLevel,
  typeBlockedMessage,
} from '../../utils/catalog-manager.utils';

/**
 * Categories & Brands → Types (ATS-388): the kinds of product (Rackets, Socks, Hoodies…) staff
 * pick in the product editor and aim offers at. Add, rename, reorder and delete (only when no
 * product uses it). The whole list saves to `settings/productTypes` on every change.
 */
@Component({
  selector: 'app-types-tab',
  host: { class: 'block w-full' },
  imports: [
    DragDropModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatTooltipModule,
    SharedIconModule,
  ],
  templateUrl: './types-tab.component.html',
})
export class TypesTabComponent {
  readonly #types = inject(ProductTypesService);
  readonly #catalog = inject(CatalogAdminService);
  readonly #dialog = inject(MatDialog);
  readonly #snackbar = inject(SnackbarService);
  readonly #platformId = inject(PLATFORM_ID);

  readonly loaded = this.#types.loaded;
  /** The list as shown; a change shows at once, before the save answers. */
  readonly items = linkedSignal(() => this.#types.types());
  readonly isSaving = signal(false);
  /** The type whose Delete check is running. */
  readonly checkingId = signal<string | null>(null);

  readonly #categoriesResource = resource({
    loader: async () => (isPlatformBrowser(this.#platformId) ? this.#catalog.listCategories() : []),
  });

  /** "Apparel › Hoodies" for every category, in menu order. */
  readonly categoryOptions = computed((): readonly TypeCategoryOption[] =>
    buildCategoryTree(this.#categoriesResource.value() ?? []).flatMap((row) => [
      { id: row.category.id, label: row.category.name },
      ...row.children.map((child) => ({ id: child.id, label: `${row.category.name} › ${child.name}` })),
    ]),
  );

  categoryLabel(id: string): string {
    if (!id) return 'No usual category';
    return this.categoryOptions().find((option) => option.id === id)?.label ?? id;
  }

  add(): void {
    this.#openEditor(null);
  }

  edit(type: ProductTypeEntry): void {
    this.#openEditor(type);
  }

  async move(type: ProductTypeEntry, step: -1 | 1): Promise<void> {
    const ids = moveWithinLevel(
      this.items().map((item) => item.id),
      type.id,
      step,
    );
    if (ids) await this.#saveOrder(ids);
  }

  async drop(event: CdkDragDrop<unknown>): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;
    const ordered = [...this.items()];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    await this.#saveOrder(ordered.map((item) => item.id));
  }

  /** ⋮ Delete: only a type no product uses; offers aimed at it stop including it. */
  async remove(type: ProductTypeEntry): Promise<void> {
    if (this.checkingId() !== null || this.isSaving() || !this.loaded()) return;
    if (this.items().length <= 1) {
      this.#snackbar.error('Keep at least one type.');
      return;
    }
    this.checkingId.set(type.id);
    let count: number;
    try {
      count = await this.#catalog.countProductsOfType(type.id);
    } catch {
      this.#snackbar.error("We couldn't check that type. Please try again.");
      return;
    } finally {
      this.checkingId.set(null);
    }
    if (count > 0) {
      this.#dialog.open<DeleteBlockedDialogComponent, DeleteBlockedDialogData>(DeleteBlockedDialogComponent, {
        data: {
          title: `${type.label} can't be deleted`,
          message: typeBlockedMessage(type.label, count),
          canSeeProducts: false,
          canHide: false,
        },
        width: '28rem',
        maxWidth: '92vw',
      });
      return;
    }
    const confirmed = await this.#confirm({
      title: `Delete ${type.label}?`,
      message: `No product uses it. Any offer aimed at ${type.label} stops including it.`,
      confirmText: 'Delete',
      cancelText: 'Keep It',
      theme: 'error',
    });
    if (!confirmed) return;
    await this.#save(
      this.items().filter((item) => item.id !== type.id),
      `${type.label} deleted.`,
    );
  }

  async #saveOrder(ids: readonly string[]): Promise<void> {
    const byId = new Map(this.items().map((item) => [item.id, item]));
    const next = ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    await this.#save(next, 'New order saved.');
  }

  async #save(next: readonly ProductTypeEntry[], done: string): Promise<void> {
    // Until the saved list loads, the built-ins are showing; saving them would overwrite it.
    if (this.isSaving() || !this.loaded()) return;
    this.isSaving.set(true);
    this.items.set(next);
    try {
      await this.#types.save(next, this.#catalog.currentUid());
      this.#snackbar.success(done);
    } catch {
      this.items.set(this.#types.types());
      this.#snackbar.error("We couldn't save the types. Please try again.");
    } finally {
      this.isSaving.set(false);
    }
  }

  #confirm(data: ConfirmDialogData): Promise<boolean | undefined> {
    const ref = this.#dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data,
        width: '28rem',
        maxWidth: '92vw',
      },
    );
    return firstValueFrom(ref.afterClosed());
  }

  #openEditor(type: ProductTypeEntry | null): void {
    const ref = this.#dialog.open<TypeDialogComponent, TypeDialogData, TypeDialogResult>(
      TypeDialogComponent,
      {
        ...CATALOG_DIALOG_CONFIG,
        data: { type, types: this.items(), categories: this.categoryOptions() },
      },
    );
    ref.afterClosed().subscribe((result) => {
      if (!result) return;
      if (result === 'delete') {
        if (type) void this.remove(type);
        return;
      }
      const list = this.items();
      const next = type ? list.map((item) => (item.id === type.id ? result : item)) : [...list, result];
      void this.#save(next, type ? 'Type saved.' : `${result.label} added.`);
    });
  }
}
