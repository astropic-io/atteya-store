import { isPlatformBrowser } from '@angular/common';
import { effect, inject, PLATFORM_ID, resource, Service, untracked } from '@angular/core';
import { AuthService } from '@core/services/auth/auth.service';
import { UserProfileService } from '@core/services/user-profile';
import { CurrencyService } from './currency.service';

/**
 * ATS-317: tells `CurrencyService` who is signed in and the country of their saved address, so
 * browsing prices follow it on a phone or browser that remembers no later choice. One read of
 * `users/{uid}` per sign-in. Created once in the browser by `provideAppInitializer` in `app.config.ts`.
 */
@Service()
export class BrowsingAccountService {
  readonly #auth = inject(AuthService);
  readonly #profiles = inject(UserProfileService);
  readonly #currency = inject(CurrencyService);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly #savedCountry = resource({
    params: () => (this.#auth.isAuthReady() ? this.#auth.user()?.uid || undefined : undefined),
    loader: async ({ params: uid }) => ({
      uid,
      country: (await this.#profiles.get(uid))?.address?.country ?? null,
    }),
  });

  constructor() {
    if (!this.#isBrowser) return;
    effect(() => {
      if (!this.#auth.isAuthReady()) return;
      const uid = this.#auth.user()?.uid ?? null;
      if (!uid) {
        untracked(() => this.#currency.setAccount(null, null));
        return;
      }
      if (this.#savedCountry.isLoading()) return;
      // A failed read: no saved country this visit (the remembered country or the guess decide).
      const loaded = this.#savedCountry.hasValue() ? this.#savedCountry.value() : null;
      const country = loaded?.uid === uid ? loaded.country : null;
      untracked(() => this.#currency.setAccount(uid, country));
    });
  }
}
