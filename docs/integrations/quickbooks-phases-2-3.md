# QuickBooks Online — Simplified invoice workflow

## Agreed business workflow

1. Accounts prepares and finalises invoices in Njia Smart.
2. Accounts sends each finalised invoice to QuickBooks Online.
3. QuickBooks is the accounting system of record for recording payments and bank reconciliation.
4. Njia Smart reads back the linked invoice status, amount paid and outstanding balance.

## Implemented scope on this branch

- Connect one QuickBooks sandbox company to a Njia Smart client using the existing OAuth/Vault foundation.
- Match the Njia Smart client to an existing QuickBooks Customer.
- Select one existing active QuickBooks **Service** item and reuse it for every line on that client's invoices.
- Send a non-draft Njia Smart invoice, preserving line descriptions, quantities and unit prices.
- Store the external QuickBooks Invoice ID and document number against the local invoice mapping.
- Use the local invoice UUID as a stable QuickBooks request ID to protect retries from duplicate creation.
- Read the QuickBooks Invoice to refresh status, total, amount paid and balance.
- Show the QuickBooks invoice link and last sync time in the Njia Smart invoice detail page.

The invoice is created in QuickBooks only. Njia Smart's operational invoice, local payment records and invoice status are not overwritten by the read-back.

## Tax and currency behaviour

Njia Smart does not send its own VAT amount or tax code. For non-US companies, the server reads the selected QuickBooks Service item's `SalesTaxCodeRef` and applies it to every invoice line, using `GlobalTaxCalculation: TaxExcluded`. For US companies, the line taxable flag is derived from the Service item's taxable setting (TAX/NON); the mapped Customer's default tax code is used when available. US companies do not receive `GlobalTaxCalculation`.

All lines use the same Service item. Consequently, all lines follow the same QuickBooks item default tax treatment (subject to the Customer's tax settings). Mixed Standard / Exempt / Zero-rated tax lines within one Njia Smart invoice are not preserved as separate tax categories by this shared-item approach. Configure the shared Service item and Customer tax settings appropriately before sending.

The local invoice currency must match the mapped QuickBooks Customer currency or the QuickBooks home currency. When multicurrency is enabled, the matching currency is included in the invoice request. Mismatches are rejected.

## Explicitly out of scope

- Creating QuickBooks Payments from Njia Smart.
- Payment approval/rejection workflows.
- Creating or capturing card charges through the QuickBooks Payments API.
- Bank reconciliation inside Njia Smart.
- Mirroring QuickBooks Payment entities into operational Njia Smart payment records.
- Full Customer/Invoice/Payment bulk synchronisation.
- Automatically creating QuickBooks Customers or Service items.
- Automatically overwriting local invoices or payments from QuickBooks.
- Production Intuit credentials or live QuickBooks API calls.

The previous broad payment-write and full-mirror UI/functions have been removed from this branch. Existing additive database foundation/mirror tables remain untouched; this implementation reuses the existing client/invoice mapping and invoice mirror structures. No new migration or live database schema change is required.

## Configuration

Server-side Vercel Preview variables (restricted to the feature branch):
- `QBO_ENVIRONMENT=sandbox`
- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_REDIRECT_URI=https://gk-nahashon-git-qbo-simplified-inv-2c23f2-hermanngugis-projects.vercel.app/api/integrations/qbo/callback`

Keep Production QBO variables unchanged. The eventual Production callback is `https://gk-nahashon.vercel.app/api/integrations/qbo/callback` and should be configured only after a separate production approval.

Only `com.intuit.quickbooks.accounting` is requested. Do not expose Intuit credentials or Supabase service-role credentials in browser variables.

## Release and test checklist

1. Confirm the Vercel Preview deployment is connected to an isolated staging Supabase project. Do not run test invoice writes against production data.
2. Confirm the Intuit Development app callback exactly matches `QBO_REDIRECT_URI`.
3. Connect a dedicated QuickBooks sandbox company.
4. Confirm currency and tax settings, and select the shared active Service item.
5. Match a dedicated Njia Smart test client to the correct QuickBooks Customer.
6. Send a finalised test invoice and compare its lines, tax and total in QuickBooks.
7. Retry the send and verify the same QuickBooks Invoice ID is retained.
8. Record a test payment directly in QuickBooks, refresh Njia Smart and compare amount paid and balance.
9. Verify no local Njia Smart invoice/payment record was changed by the status refresh.
10. Review CI, Vercel runtime logs and Supabase advisors before release.

A successful build is not equivalent to a successful end-to-end Intuit sandbox test. Production release requires a separate review and explicit approval.
