import type { FirebaseOptions } from 'firebase/app';

export interface Environment {
  production: boolean;
  baseUrl: string;
  googleMapsApiKey: string;
  firebase: FirebaseOptions;
  imageKitUrl: string;
  /** Meta (Facebook) Pixel id for the client's ads (ATS-290). Live store only; empty on dev. */
  metaPixelId?: string;
  /**
   * Admin Overview page (ATS-340). On for both the dev site and the live store (Youssef, 27 Nov
   * 2026). Set it to false in an environment file to hide the page and its menu item there.
   */
  adminOverview?: boolean;
  algolia: {
    appId: string;
    searchKey: string;
    indexName: string;
    priceAscIndex: string;
    priceDescIndex: string;
  };
  appCheck?: {
    siteKey: string;
    isTokenAutoRefreshEnabled?: boolean;
    debug?: boolean;
  };
}
