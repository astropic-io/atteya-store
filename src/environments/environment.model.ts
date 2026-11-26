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
   * Admin Overview page (ATS-340). On for the dev site only until the client agrees to it, so a
   * release to the live store doesn't show it. Turn it on in environment.prod.ts to launch.
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
