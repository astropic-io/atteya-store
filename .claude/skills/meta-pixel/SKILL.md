---
name: meta-pixel
description: The client's Meta Pixel ads tracking - MetaPixelService, which events are sent where (PageView, ViewContent, Search, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase), the Purchase value in EGP, when nothing is sent, and the debug switch. Read it before changing MetaPixelService, adding a shop action that matters to ads, or editing the privacy page's cookies section.
---

# Meta Pixel (ads tracking)

- `MetaPixelService` (`@core/services/analytics/meta-pixel.service`) sends the client's Meta Pixel events (<KEY>-290). It runs in the browser only and only when `environment.metaPixelId` is set, which is the live store (`environment.prod.ts`); dev sends nothing.
- `provideAppInitializer` in `app.config.ts` calls `start()`, which sends PageView once per path (query-only changes and `/admin` pages are skipped) and loads Meta's script on the first store page, never on `/admin`.
- Events and where they are sent: ViewContent (product page, once per product), Search (search page, once per query), AddToCart (`app-add-to-bag-button` and the Bundle & Save page), InitiateCheckout (checkout, once the bag is priced), AddPaymentInfo (first payment pick, or Place Order), Purchase (after Place Order for InstaPay, Cash on Delivery and Bank Transfer; on the order page within 2 hours of a Card payment).
- The Purchase value is the EGP the store receives (`receivedEgp()`, <KEY>-316): the Egypt total, or for an order abroad `chargeEgp` (Card) / `payIn.amount` at the plain rate (Bank Transfer).
- Money goes to Meta in EGP with product ids. Free gift lines are left out of Purchase. Purchase is sent once per order per browser (`metaPixelPurchases` in localStorage) with event id `purchase-<orderId>`, ready for Conversions API de-duplication.
- Nothing goes to Meta while the address bar holds a guest order's `?key=`, also inside an encoded `returnUrl` (it opens the order with the guest's address), or an order page address with Paymob's return details (also inside a `returnUrl`). The order page clears both from its address, and the Card Purchase waits for that. Meta's own PageView on history changes (`disablePushState`) and its automatic events (`autoConfig`) are off, so only the service's events are sent.
- Set `localStorage.metaPixelDebug = '1'` in a browser to print every event in the console (works on dev, where nothing is sent).
- New shop actions that matter to ads call `MetaPixelService.track()` with a Meta standard event; never add Meta's snippet to `index.html`. The privacy page's cookies section must stay in line with what is sent.
