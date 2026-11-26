---
name: returns-and-exchanges
description: Returns & Exchanges for shoppers and staff - who can send a request and when, the kinds (Different Size, Different Colour, Return It, Damaged Item, Wrong Item Sent), statuses, the free gift rule, refund and courier fee math, the stock plan per kind, the requestReturn and cancelReturnRequest callables, returnRequests and the order's returns summary, and the return emails. Read it before changing any of these.
---

# Returns & Exchanges

Built in four tickets: <KEY>-291 (server, shared rules, first emails), <KEY>-292 (shopper screen), <KEY>-293 (admin Returns page and stock moves), <KEY>-294 (later emails and the Terms page).
<KEY>-303 changed how the courier fee is paid: by InstaPay after Approve and before the courier comes (Waiting for Payment).
<KEY>-307 added sending a paid fee back (Fee Sent Back), the 2-day fee reminder and the 5-day automatic cancel.

**How to edit this file:** one fact per line, as a list item under the heading it belongs to. Add a new rule as its own line, or a new `##` heading for a new topic. Never join rules into one long paragraph: Git merges line by line, so two PRs that touch the same long line conflict even when they change different sentences.

## Where the rules live

- Every rule is in `functions/src/store/returns.ts` (pure, no Firestore). Edit only that file, then run `npm run sync:engine`, which copies it to `src/app/core/config/returns.ts` for the website.
- The callable input check and the request builder are in `functions/src/returns/return-request.ts` (`parseRequestReturn()`, `buildReturnRequest()`), pure and unit tested.
- Tests: `functions/src/returns/returns.test.ts` (in `npm test --prefix functions`) covers every row of the stock table, the window, gifts, money, refusals and the two request emails.
- Returns are recorded next to the order, never by changing `pricing.lines` or any order total.

## Who and when

- Only **Delivered** orders, until 14 days after `deliveredAt` (`RETURN_WINDOW_DAYS`, `returnEligibility(order, nowMs)`).
- Orders with no `deliveredAt` and orders shipped outside Egypt (`pricing.isInternational`) are refused with "Please message us on WhatsApp about a return or exchange for this order."
- One open request per order at a time: Requested, Waiting for Payment, Approved, or Received while a refund is still to send (`isOpenReturn()`).
- A piece already in a request that isn't Rejected or Cancelled can't be asked for again (`piecesLeft()`).
- At most 10 requests per order, cancelled and rejected ones included (`RETURN_REQUESTS_PER_ORDER_MAX`), so a cancel and resend loop can't flood the staff inbox.
- The signed-in owner is matched by uid (`customerId`); a guest by the order's secret `viewKey` from the emailed order link (`isOrderShopper()` in `functions/src/returns/return-access.ts`, constant-time compare).
- Every refusal has a plain message (`returnRefusalMessage()` and `ReturnRequestError` in `return-request.ts`, turned into an `HttpsError` by the callable).
- **Start Return for Customer (<KEY>-342)**: on `/admin/orders/:id`, while the shopper could send a request (`returnEntry()` open), staff open the same Return or Exchange screen with `forCustomer` (title "Return or Exchange for <name>", the refund number prefilled with the phone, a Courier fee choice "Customer pays … by InstaPay first" or "The store pays").
- `requestReturn` with `forCustomer: true` checks the staff role instead of the owner and saves `startedByStaff`, `startedBy`, `startedByEmail` and `storePaysFee` (fee 0 when the store pays). A request started by staff sends no Request Sent or staff alert.
- The page then approves it straight away (`approveReturnRequest`), so the customer gets the usual Approved email (or its pay version); with a Wrong Item Sent item it opens `/admin/returns/:id` to pick the sent piece and approve there.

## Kinds

- Kinds are chosen per item, with pieces and quantity per item: `different-size` (Different Size), `different-colour` (Different Colour), `return` (Return It), `damaged` (Damaged Item), `wrong-item` (Wrong Item Sent).
- Different Size: same product (still there and not hidden), a size id from the product's `size` option that differs from the one bought.
- Different Colour: another product with the same non-empty `modelGroup`, not hidden (`published !== false`), with the same `price` as the product bought; a different price is refused with "Different price, message us on WhatsApp."; a size is required when the colour has sizes.
- Return It needs a reason: `didnt-fit` (Didn't fit), `not-as-pictured` (Not as pictured), `changed-mind` (Changed my mind), `other` (Other).
- Damaged Item wants `send-another` (Send Another) or `refund` (Refund); Wrong Item Sent wants `send-right-one` (Send the Right One) or `refund` (Refund).
- An optional note per request, at most 500 characters (`RETURN_NOTE_MAX`); `refundTo` (InstaPay number or address, at most 100 characters) is required when any item is a refund.
- Each saved item carries `askedLabel` for emails and the admin: `Size M → L`, `Black → White · Size L`, `Return · Didn't fit`, `Damaged · Send Another`, `Wrong Item · Refund`.
- Exchanging for a different product is not a kind: shoppers pick Return It with Other and explain, staff handle it on WhatsApp.
- No photo upload on the website: shoppers send photos on WhatsApp.

## Statuses

- `requested` → `approved` → `received`; a request with any refund item goes on to `refund-sent` (`nextReturnStatuses()`).
- A request whose shopper pays the courier fee first (`feePaid: 'instapay-first'` and a fee above 0, `returnPaysFirst()`) goes `requested` → `waiting-for-payment` → `approved` (<KEY>-303).
- Approve's target comes from `returnApproveStatus(feePaid, feeEgp)`: Waiting for Payment with a fee to pay first, else Approved (no fee, or a request saved before <KEY>-303).
- Waiting for Payment → Approved is only staff's **Payment Received** (`confirmReturnPayment`); Item Received is never possible from Waiting for Payment.
- `rejected` (with a reason shown to the shopper) is possible any time before Received; `cancelled` (by the shopper) while Requested or Waiting for Payment.
- Names (`returnStatusLabel()`): Requested, Waiting for Payment, Approved, Received, Refund Sent, Rejected, Cancelled. The shopper sees the same names as staff.
- Waiting for Payment holds pieces (`returnHoldsPieces()`), like Approved: Approve already took the new pieces.
- Request ref: `#R-` + the first 6 characters of the request id in capitals (`returnRef()`), like the order ref.

## Free gifts

- Gifts (`pricing.lines[].gift.forLine`) stay with the shopper on any exchange.
- On a refund, the line's gifts come back too: over all the order's requests, floor(refunded pieces × gift pieces ÷ line pieces), and all of them once every piece of the line is refunded; a request sends back only what that adds now (`giftsBack()`, which reads earlier refunds and returned gifts from the order's `returns`).
- Returned gifts are added to the request automatically (`autoGift: true`, `forLine`); exchanged pieces never bring a gift back.
- A gift line can be exchanged for size or colour, never returned alone for money.

## Money

- Refund per piece = what was paid after offers: `lineDisplay ÷ quantity` (whole EGP), the whole line exactly (`refundEgpFor()`); older lines use `fullEgp − discountEgp`, else `unitEgp × quantity`.
- Partial refunds are rounded on the running total of the line's refunded pieces, so every refund of one line together is exactly what was paid.
- Buy X Get Y and bundle discounts are not taken back on a partial return: the refund is the line's own `lineDisplay` share (the brief's rule).
- Courier fee = the order's own delivery fee (`pricing.shipping.priceEgp`, the agreed fee for `domestic-agreed`); when it was 0 (free shipping) the order box's normal price in `settings/shipping` (`normalBoxFeeEgp()` in `functions/src/store/returns.ts`, the biggest Egypt box when the order has none) (`courierFeeEgp()`).
- The fee is 0 when any item is Damaged or Wrong Item Sent (the store pays, `storeFault`).
- Otherwise the shopper pays the fee by InstaPay after Approve and before the courier comes (`instapay-first`, `returnMoney()`, <KEY>-303); the refund is the full paid share of the refunded pieces (`refundEgp` = `itemsEgp`) and `cashAtDoorEgp` is 0.
- Requests saved before <KEY>-303 keep `off-refund` (fee taken off the refund, any rest as `cashAtDoorEgp`) or `cash` (cash at the door, exchange only); every screen and email still reads them (`readCourierFeePaid()`), and their Approve goes straight to Approved. No data script.
- The shopper's WhatsApp message with the InstaPay screenshot: `returnPaymentWhatsappText(ref, orderRef, feeEgp)` (Arabic, English digits).
- The original delivery fee is never refunded.
- Refunds are sent by InstaPay after the items are Received; Paymob automatic refunds are not built.

## Stock plan

- `returnStockPlan(items)` turns a request into `approve`, `reject` and `received` steps of `take` / `putBack` pieces (`{ productId, selection, quantity }`); `applyStockMoves()` applies them (see Staff steps).
- Different Size / Different Colour: new piece −1 at Approve; returned piece +1 at Received if it can be sold again.
- Return It: nothing at Approve; piece +1 at Received if it can be sold again.
- Damaged · Send Another: the same piece −1 at Approve; nothing back by default (`canBeSoldAgain` defaults off for Damaged).
- Damaged · Refund: nothing at Approve; nothing at Received by default.
- Wrong Item Sent · Send the Right One: the piece actually sent −1 at Approve (the ordered piece +1 then −1 = no change); the sent piece +1 at Received.
- Wrong Item Sent · Refund: the sent piece −1 and the ordered piece +1 at Approve; the sent piece +1 at Received.
- For wrong items staff choose the piece actually sent at Approve (`sentPiece`); until then the item is listed in `missing`.
- Reject after Approve moves the plan's `reject` step (<KEY>-298): every kind undoes what Approve took, except Wrong Item Sent.
- Wrong Item Sent rejected after Approve keeps both corrections: the piece we sent stays −1 (the customer has it) and the ordered piece stays +1 (it is on our shelf).
- Wrong Item Sent · Send the Right One rejected after Approve puts the ordered piece back +1 (the −1 for the right one is undone, since we never sent it); Wrong Item Sent · Refund rejected moves no stock.
- `undoStockStep()` (swap `take` and `putBack`) is only the fallback for requests approved before `rejectStock` was saved.
- While any request on an order holds pieces (not Rejected or Cancelled, or Rejected with `keptItems`), staff can't step the Delivered order back to Shipped (`hasReturnHoldingPieces()`), so a later cancel never puts those pieces into stock a second time. Details in the `checkout-and-orders` skill.
- A Wrong Item Sent request rejected after Approve keeps holding its pieces (<KEY>-299), because Reject keeps their stock corrections.
- Reject saves those line pieces as `keptItems` on `returnRequests/{id}` and on the order's `returns` entry, in the same transaction (`rejectKeptItems()` in `return-staff-step.ts`).
- `piecesLeft()` counts `keptItems` as used, so the shopper's screen shows "Already requested" for that line and `requestReturn` refuses it.
- `hasReturnHoldingPieces()` counts a Rejected entry with `keptItems`, so the admin menu hides Back to Shipped and the server refuses the step back.
- Requests rejected before Approve, requests approved before `rejectStock` was saved, and every other kind rejected after Approve keep nothing and hold no pieces.
- If the shopper needs anything more for that item, staff handle it on WhatsApp.

## Data

- `requestReturn` reads `settings/shipping` only when the order's delivery fee was 0.
- `requestReturn` (`functions/src/returns/request-return.fn.ts`, `europe-west3`, App Check like every callable) takes `{ orderId, viewKey?, items[], note?, refundTo? }`; each item is `{ lineIndex, quantity, kind, reason?, wants?, size?, colourProductId? }`; it answers `{ requestId, ref }`.
- In one transaction it creates `returnRequests/{id}` and appends to the order's `returns` array `{ id, ref, status, hasRefund, storeFault, refundEgp, items: [{ lineIndex, quantity, refund, autoGift, askedLabel }], createdAt }` (built by `returnSummaryEntry()`; `createdAt` is a Timestamp from the function's clock, because arrays can't hold server time stamps).
- Entries of requests that pay the fee first also carry `payFeeEgp` (the fee, whole EGP) for the request box's pay steps (<KEY>-303).
- The summary carries only what the shopper's request box shows (<KEY>-296): `askedLabel` is the same text as `returnRequests/{id}.items[].askedLabel`, `refundEgp` is the refund after the courier fee; never `refundTo`, the note, the customer, the staff history or staff notes, because shoppers and guests (`orderViews`) read it.
- Entries written before <KEY>-296 have no `storeFault`, `refundEgp` or `askedLabel`; `readReturnSummaries()` leaves these out, the website reads them with `readRequestDetails()`.
- `returnRequests/{id}` holds `ref`, `orderId`, `orderRef`, `status`, `customerId`, `guest`, `customerEmail`, `customer` (name, phone, email, country, address), `items` (line, kind, reason, wants, refund, gift, autoGift, forLine, product, selection, name, photo, new piece, `askedLabel`, `refundEgp`), `note`, `refundTo`, `hasRefund`, `storeFault`, `itemsEgp`, `feeEgp`, `feePaid`, `refundEgp`, `cashAtDoorEgp`, `orderDeliveredAt`, `createdAt`, `updatedAt`.
- `cancelReturnRequest` (`functions/src/returns/cancel-return-request.fn.ts`, same owner check, `{ requestId, viewKey?, feeAlreadyPaid? }`, transaction in `runCancelReturn()`) sets the request to Cancelled while it is Requested or Waiting for Payment, updates its entry in the order's `returns` and sends nothing; calling it again answers `changed: false`.
- Cancel from Waiting for Payment moves the `rejectStock` saved at Approve once (`stockUndoneAt`), exactly like Reject, so the held new piece goes back into stock (<KEY>-303).
- A cancel from Waiting for Payment adds a `returnStaffNotes/{id}.history` row (`by: 'shopper'`), since the shopper may already have sent the fee; the cancel dialog asks them to message us on WhatsApp if they did.
- Cancel refuses a request whose Reject would keep Wrong Item Sent corrections (`rejectKeptItems()`); such a request has no fee to pay first, so this only guards against a later rule change.
- Every callable that moves a request updates the order's summary with `withReturnStatus()` in the same transaction, so `returns` always matches `returnRequests/{id}`.
- Reject also passes its reason to `withReturnStatus(raw, id, 'rejected', { rejectReason })`, which saves it as `rejectReason` on that entry (trimmed; only with Rejected), so the shopper sees why.
- Refund Sent passes `{ refundSentEgp }`, which saves the amount staff really sent as `refundSentEgp` on the entry (`refundEgp` stays the planned refund); the shopper's box shows `refundSentEgp` when it is there (`readRequestDetails()`).
- The request box never shows a refund of EGP 0 (the courier fee took it all): it then says the refund without an amount.
- `orderViewFields()` copies `returns` into `orderViews/{viewKey}` so guests see the status.
- Firestore rules: `returnRequests`, `returnStaffNotes` (staff-only history, written by the step callables) and `returnEmails` are read by admin and staff only, with no client writes; orders stay server-written, so `returns` is written only by Cloud Functions.

## Shopper screen (website)

- Feature folder: `src/app/features/returns/` (`dialogs/return-request-dialog`, `components/return-request-box`, `services/returns.service.ts`, `utils/`).
- `returnEntry(order, nowMs)` (`src/app/core/services/orders/order-returns.ts`) decides what the order page and Account → Orders show: the **Return or Exchange** button (`open`, with the last day), "Returns closed on 27 Nov. Message us on WhatsApp if something is wrong." (`closed`), or nothing; it wraps `returnEligibility()`.
- The order schema (`OrderSchema` and `OrderViewSchema`) keeps the order's `returns` raw; read it with `readReturnSummaries()`.
- The request screen opens with `RETURN_REQUEST_DIALOG_CONFIG` (`panelClass: 'return-request-pane'`: a 40rem dialog on desktop, full screen below 640 px in `_dialog.scss`).
- Account → Orders opens the order page with router state `{ openReturn: true }`, and the page opens the screen once the order loads (then clears the state so a reload doesn't reopen it).
- Each item's live product is read when the screen opens (`ReturnsService.productReader()`, one read per product); the model's other colours (`modelGroup`, one query) are read once an item asks for Different Colour. Reads are kept only while the screen is open; sold-out sizes and the size they have are disabled, colours with another price are greyed out.
- "What would you like?" comes from the live product (`kindsFor(line, product)`): Different Size only when its `size` option has more than one size, Different Colour only when `colorSiblings` names another product (or, before that list is filled, it has a `modelGroup`). It shows `<app-skeleton>` while the product loads.
- A free gift whose product has neither choice can't be ticked: its checkbox is disabled with "This gift can't be exchanged." It still comes back with a refunded item.
- When every other size is sold out the sizes stay, disabled, with "No other sizes in stock right now."
- Request screen spacing: 24px (`gap-6`) between item cards, sections and fields; long field explanations sit as text under the section heading, not as a two-line `mat-hint` (fixed hint space, no `subscriptSizing="dynamic"`).
- Send Another / Refund is a `mat-button-toggle-group.return-wants` (two equal halves, `_button-toggle.scss`).
- Send Request waits for `settings/shipping` when the order's delivery fee was 0, so the refund after the fee is never shown or saved without the fee.
- The button shows only while some piece is left to ask for (`piecesLeft()`).
- The refund, courier fee and returned gifts on the screen come from `returnPreview()` (`features/returns/utils/return-request.utils.ts`), which calls the same shared rules as `buildReturnRequest()`; the courier fee's box price uses the shared `normalBoxFeeEgp()` (`@core/config/returns`) with `ShippingSettingsService.settings()`, the same function `requestReturn` calls, so the fee on the screen and the saved fee never differ.
- Send Request calls `requestReturn`; errors show `callableMessage()`; on success the snackbar says "Request sent. We'll message you on WhatsApp."
- The order page shows `app-return-request-box` for each entry of the order's `returns`, newest first, live; **Cancel Request** (asks first) calls `cancelReturnRequest` while Requested or Waiting for Payment.
- The request dialog's Summary shows "Courier fee EGP 60" with "You pay it by InstaPay once we approve your request." under it, and the refund is the full paid share (<KEY>-303).
- While Waiting for Payment the box shows the `.pay-steps` list (Send EGP 60 by InstaPay with the store InstaPay details from `STORE_INFO.payments.instapay`, or "We'll send you the InstaPay details on WhatsApp." when empty; Send the screenshot on WhatsApp; We send the courier) and **Send Screenshot on WhatsApp** (`returnPaymentWhatsappText()`).
- The box reads each item's `askedLabel`, `storeFault`, `refundEgp` and `rejectReason` from the order's `returns` summary (`readRequestDetails()`), so any browser shows the same box; for entries written before <KEY>-296 it falls back to what this browser sent (`localStorage.returnRequests`, `return-memory.ts`), else shows Refund / Exchange per item and no **Send Photos on WhatsApp**.

## Emails

- `sendReturnEmails` (`functions/src/email/send-return-emails.trigger.ts`, `onDocumentWritten returnRequests/{requestId}`, `europe-west3`, no retry) sends through Resend like the order emails.
- Which email: `returnEmailsForWrite()` in `return-email-events.ts`; a new Requested request sends `store-return-request` (to `STORE_ALERT_EMAIL`) and `return-requested` (to the shopper).
- Each (request, email) is claimed in `returnEmails/{requestId}_{kind}` (`create()`, then `sent` or `failed`), so a repeated trigger never sends twice; a failure is not retried automatically.
- Templates are in `return-email-templates.ts` ("Bold Black" blocks from `email-blocks.ts`), each with a plain-text version; the shared links and WhatsApp context come from `emailContext()` in `email-context.ts`.
- Staff alert: kicker `RETURN REQUEST · 13 NOV · 14:32` (Cairo), the request ref very large, `For order #A1B2C3 · delivered 10 Nov`, a strip of Items, Refund and Courier Fee (with "off the refund", "cash at the door" or "the store pays"), the next-step box "Approve or reject this request", the customer with **Message Customer on WhatsApp** (`returnStaffWhatsappText()`), What They Asked For (×N tag, `askedLabel`, refund amount, gifts as strips), the customer's note, the money and **Open Request** to `/admin/returns/<id>`.
- Shopper email: header with the order ref, kicker `RETURN OR EXCHANGE · #R-…`, status `REQUEST SENT`, What Happens Next (we check it, the courier comes to the delivery address, the InstaPay refund), Your Items, the money, **View Your Order** (`orderConfirmationUrl()`, with `?key=` for guests).
- Damaged or wrong items add a dashed box with **Send Photos on WhatsApp**, prefilled with the request and order refs (`returnPhotosWhatsappText()`); without a store WhatsApp it asks for a reply with a photo when replies reach an inbox.
- Each staff step forward sends one shopper email (<KEY>-294): Requested → Approved sends `return-approved`, Requested or Approved → Rejected sends `return-rejected`, Approved → Received sends `return-received`, Received → Refund Sent sends `return-refund-sent`.
- Requested → Waiting for Payment sends `return-approved` in its pay version (amount, InstaPay steps with the store details, **Send Screenshot on WhatsApp**, Hand Over / You Get, View Your Order); it does not say the courier is coming (<KEY>-303).
- Waiting for Payment → Approved sends `return-payment-received` (`PAYMENT RECEIVED`, "We got your EGP 60. Our courier will come to your delivery address.", then Hand Over / You Get); Waiting for Payment → Rejected sends `return-rejected`.
- Request Sent for a request that pays first adds the step "Once we approve it, you pay the EGP 60 courier fee by InstaPay." and its totals show the fee as "Courier fee, by InstaPay after approval"; the staff alert's fee note says "paid by InstaPay before pickup".
- Cancelled, a step back, a skipped step, the same status written again, or a request created in a later status sends nothing.
- A Refund Sent of EGP 0 (the courier fee used up the refund) sends nothing; the Received email already says there is nothing more to send.
- Every shopper status email has the black header with the order ref, kicker `RETURN OR EXCHANGE · #R-…`, **View Your Order** and the WhatsApp or reply footer, plus a plain-text version with the same facts in the same order.
- Approved (`REQUEST APPROVED`): "Our courier will come to your delivery address.", Hand Over (every piece, free gifts going back included), You Get (new pieces, then the InstaPay refund), and a grey box with the courier fee (free / cash at your door / taken off your refund).
- Rejected (`WE CAN'T TAKE IT BACK`): staff's `rejectReason` in a grey box, a full-width **Message Us on WhatsApp** button (no second one in the footer), and the items with gifts marked "Stays with the …".
- Received (`ITEMS RECEIVED`): exchange-only says "Your exchange is done."; with a refund it says "We got your items. Your refund of EGP 850 is on its way by InstaPay."
- Refund Sent (`REFUND SENT`): the amount staff sent (`refundSentEgp`), "Sent by InstaPay to 0100 123 5678" (the full `refundTo`, so the shopper can spot a wrong number, <KEY>-342) and the reference when staff gave one, then only the refunded items.
- Approved, its pay version and Payment Received show the refund with the full `refundTo` and a "Not yours? Message us" note, and every item of the order by state (Delivered, ↩ Returning, ✕ Cancelled) from `readOrderForEmail()` (<KEY>-342).
- Tests for which email each status change sends and the four templates: `functions/src/email/return-emails.test.ts` (in `npm test --prefix functions`).

## Staff steps (admin Returns)

- `/admin/returns` (`ReturnsManagerPageComponent`, `features/admin/pages/returns-manager/`) lists requests newest first, 20 per **Show More Requests**, with tabs Requested, Waiting for Payment, Approved, Received, Refund Sent, Rejected, Cancelled, All (index `returnRequests` `status` + `createdAt` desc); the search field filters the requests on screen.
- The admin menu's **Returns** item shows the count of Requested and Waiting for Payment (<KEY>-303) (`AdminNavService`, `getCountFromServer`), read again after each step (`refreshReturnsCount()`).
- `/admin/returns/:requestId` (`ReturnDetailsPageComponent`) shows refs (order ref links to `/admin/orders/:id`), the customer with **Message Customer on WhatsApp** (`returnStaffWhatsappText()`), items with photo, options, what was asked and live stock per piece (now and what each step does), money, the shopper's InstaPay details and note, and the staff history.
- `/admin/orders/:id` and the open order in the Orders list show a **Returns** line (`app-order-returns-line`, reads `returnRequests` by `orderId`).
- Callables (`europe-west3`, `requireRole`): `approveReturnRequest`, `confirmReturnPayment` (<KEY>-303), `rejectReturnRequest`, `receiveReturnRequest` (admin and staff) and `markRefundSent` (admin only, checked on the server).
- **Payment Received** (`confirmReturnPayment`, only from Waiting for Payment) asks "Did the EGP 60 arrive by InstaPay?", then moves the request to Approved and stamps `paymentReceivedAt` / `paymentReceivedBy`; no stock moves.
- All five run `runReturnStep()` (`functions/src/returns/return-staff-transaction.ts`): one transaction reads the request, order and products, checks the move with `nextReturnStatuses()`, moves stock, stamps the request, updates the order's `returns` with `withReturnStatus()` and appends `{ status, from, at, by, byEmail?, reason? }` to `returnStaffNotes/{id}.history`.
- The pure part is `functions/src/returns/return-staff-step.ts` (input checks, `withSentPieces()`, `approvePlan()`, `approveStep()`, `receiveStep()`, `rejectStockFor()`, `applyStockMoves()`), tested in `return-staff-step.test.ts`.
- Already in the target status answers `changed: false` and writes nothing, so a double click or two staff at once never move stock twice.
- Approve: Wrong Item Sent first asks "What Did We Send Instead?" (`app-sent-piece-picker` searches any product with `ProductsAdminService.searchProducts()`, then a size) and saves `sentProductId` / `sentSelection` on the item.
- Approve applies the plan's Approve moves once (`stockTakenAt`) and saves them as `approveStock`, plus the plan's Reject moves as `rejectStock`; a sold-out new piece refuses with "Size L is sold out. Ask the customer to pick another size or switch this item to a refund." and nothing changes.
- Reject needs a reason the shopper sees (300 characters, `rejectReason`), works from Requested, Waiting for Payment or Approved, and after Approve moves `rejectStock` once (`rejectStockFor()`, `stockUndoneAt`; a request without `rejectStock` undoes `approveStock`); a count that is too low stops at 0 so a reject is never blocked.
- Item Received (from Approved) saves each item's `canBeSoldAgain` (on by default, off for Damaged Item, always on for Wrong Item Sent, which shows no switch) and puts those pieces back once (`stockReturnedAt`); exchange-only requests are done here.
- Refund Sent (admin, from Received with a refund) saves `refundSentEgp` and an optional `refundReference`; no stock moves.
- The Reject dialog lists what happens to stock per item (`rejectStockLines()`; a request approved before `rejectStock` existed shows one line saying Approve is undone), e.g. "Club Tee, Size M stays with the customer. Club Shorts, Size M goes back into stock."
- Stamps: `approvedAt` / `approvedBy`, `rejectedAt` / `rejectedBy`, `receivedAt` / `receivedBy`, `refundSentAt` / `refundSentBy`.
- Pieces whose product or size is gone are counted in `stockNotReturned` and the snackbar asks staff to check that product.

## Courier fee sent back, reminder and automatic cancel (<KEY>-307)

- A paid courier fee comes back in full when the request ends before pickup: `returnFeeBackEgp(saved, from, feeAlreadyPaid)` in `functions/src/store/returns.ts`.
- Shopper Cancel from Waiting for Payment: the cancel dialog (`features/returns/dialogs/cancel-return-dialog`) has "I already sent the EGP 115 courier fee"; ticked, `cancelReturnRequest` gets `feeAlreadyPaid: true` (refused from Requested).
- Reject from Waiting for Payment: the Reject dialog has "The customer already paid the courier fee" (`rejectReturnRequest` `feeAlreadyPaid`, refused from Requested).
- Reject from Approved saves the fee to send back automatically when `paymentReceivedAt` is set (no checkbox); the dialog says so.
- The fee to send back is saved as `feeBackEgp` on `returnRequests/{id}` and on the order's `returns` entry (`withReturnStatus(..., { feeBackEgp })`).
- **Fee Sent Back** (`markFeeSentBack`, `europe-west3`, App Check, `requireRole` admin only) saves `feeSentBackEgp` (1 to the fee), `feeSentBackTo` (required, 100 characters), `feeSentBackReference` (optional, 100 characters), `feeSentBackAt`, `feeSentBackBy`; refuses when there is no fee to send back or it was already sent (`runFeeSentBack()` in `return-staff-transaction.ts`).
- Fee Sent Back writes only `feeSentBackEgp` and `feeSentBackAt` (a Timestamp) on the order's `returns` entry (`withReturnFeeSentBack()`), never Sent to or the reference; `orderViews` follows through `syncOrderView`.
- Staff history rows can carry a `label` the admin shows instead of the status name ("Fee sent back: EGP 115", "Cancelled: the courier fee didn't arrive in 5 days").
- Admin `/admin/returns/:id` shows the red `text-error` line "Fee to send back: EGP 115", then "Fee sent back: EGP 115 · 14 Nov" (`feeBackLine()`); the Returns list shows the same line under the money; only admins see the **Fee Sent Back** button.
- The shopper's request box shows "We'll send your EGP 115 courier fee back by InstaPay." until Fee Sent Back, then "Fee sent back: EGP 115 · 14 Nov" (`readRequestDetails()` reads `feeBackEgp`, `feeSentBackEgp`, `feeSentBackAt`).
- Approve into Waiting for Payment stamps `waitingForPaymentAt`; requests without it fall back to `approvedAt` (`waitingForPaymentStartMs()`).
- `chaseReturnFees` (`functions/src/returns/return-fee-chase.schedule.ts`, `onSchedule` every hour, `europe-west3`) finds Waiting for Payment requests by `status` + `waitingForPaymentAt` (index in `firebase/firestore.indexes.json`) and decides with `returnFeeChase()`.
- After `RETURN_FEE_REMINDER_DAYS` (2) it stamps `feeReminderSentAt` once in a transaction; that write makes `sendReturnEmails` send `return-fee-reminder` (shopper, pay steps again, "If it doesn't arrive by 19 Nov, we'll cancel the request.") and `store-return-fee-reminder` (staff).
- The shopper is always reminded before the cancel: the cancel day is `returnFeeCancelAtMs(start, reminderMs)`, 5 days after the start but never sooner than 3 days after the reminder (older requests without `waitingForPaymentAt` get their reminder first).
- A shopper's ticked "I already sent" is saved with `feeBackClaimedBy: 'shopper'`; the admin page and the Fee Sent Back dialog then ask staff to check the fee arrived in InstaPay first.
- A request that cancelled itself (`cancelledBy: 'system'`) can still get Fee Sent Back up to the whole fee (`returnFeeBackLimitEgp()`), for a fee that arrived just before the cancel; a shopper's ticked Cancel on such a request is refused with a message to use WhatsApp.
- After `RETURN_FEE_AUTO_CANCEL_DAYS` (5) it cancels through `runCancelReturn()` (`functions/src/returns/return-cancel.ts`), the same transaction as the shopper's Cancel, with `cancelledBy: 'system'`; the held new piece goes back once (`stockUndoneAt`), and the summary entry gets `autoCancelled: true`.
- Every chase re-checks the live request inside its transaction, so a Payment Received or Cancel that lands first wins.
- `return-auto-cancelled` (`REQUEST CANCELLED`, Message Us on WhatsApp, View Your Order) goes only on Waiting for Payment → Cancelled with `cancelledBy: 'system'`; the shopper's own Cancel still sends nothing.
- `return-fee-sent-back` (`FEE SENT BACK`, "…to …5678", reference when given) goes when `feeSentBackAt` first appears; the Rejected email adds "We'll send your EGP 115 courier fee back by InstaPay." while `feeBackEgp` is still to send.
- All stock writes of the return steps go through `writeStockMoves()` (`return-staff-transaction.ts`); products are read first with `readStepProducts()`.

## How items come back

- The courier collects from the order's delivery address, the same way it was delivered; an exchange is one visit that swaps at the door.
- The website doesn't connect to the courier.
