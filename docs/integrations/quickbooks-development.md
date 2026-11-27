# QuickBooks Online — Njia Smart invoice integration (sandbox)

## Purpose and boundaries

The integration follows a deliberately small workflow:

1. Accounts creates and finalises an invoice in Njia Smart.
2. Accounts sends that invoice to the connected QuickBooks Online company.
3. QuickBooks remains the accounting system of record for payment recording and bank reconciliation.
4. Njia Smart refreshes the linked QuickBooks invoice to show its status, amount paid and outstanding balance.

Njia Smart does not create QuickBooks payments, reconcile bank accounts, import QuickBooks payments into its operational payment table, or overwrite its own invoice/payment records.

This branch is sandbox-only. It must not be deployed with production Intuit credentials.

## Intuit app setup

The app requests only the QuickBooks Accounting scope:

`com.intuit.quickbooks.accounting`

Payment and OpenID scopes are not required for invoice creation or invoice-status reads.

Register the Preview callback below in the Intuit Development app and configure the same URL only in the Vercel Preview variables for branch `qbo-simplified-invoice-sync`:

`https://gk-nahashon-git-qbo-simplified-inv-2c23f2-hermanngugis-projects.vercel.app/api/integrations/qbo/callback`

The eventual Production callback is `https://gk-nahashon.vercel.app/api/integrations/qbo/callback`; do not change or reuse Production environment values while testing this branch. Intuit may have both redirect URLs registered. Confirm each deployed callback exactly matches its own Vercel environment value. Do not add a trailing slash, query string or different path.

## Environment variables

Configure these as server-side Vercel Preview variables, restricted to branch `qbo-simplified-invoice-sync`, and in the ignored local `.env.local` for local development. Keep the existing Production variables unchanged:

```dotenv
QBO_ENVIRONMENT=sandbox
QBO_CLIENT_ID=your_Intuit_Development_Client_ID
QBO_CLIENT_SECRET=your_Intuit_Development_Client_Secret
QBO_REDIRECT_URI=https://gk-nahashon-git-qbo-simplified-inv-2c23f2-hermanngugis-projects.vercel.app/api/integrations/qbo/callback
```

Never commit the client secret, place it in a `VITE_*` variable, or expose it to browser code. The server reads and rotates OAuth credentials through the existing Supabase Vault functions.

## Client and Services-item setup

For each Njia Smart client:

1. Connect the client's QuickBooks company from the client's Integrations tab.
2. Open an invoice for that client.
3. Select the matching existing QuickBooks Customer.
4. Select the existing active QuickBooks item of type **Service** to use for all invoice lines.
5. Save the mapping.

The Customer match is stored in `integration_record_mappings` as a client-to-customer link. The shared Service item ID is stored in the connected integration's server-side metadata. No new QuickBooks Customer or Service item is created by Njia Smart.

## Sending an invoice

Only a non-draft Njia Smart invoice with at least one line can be sent. The server reads the invoice and its line items directly from Supabase; it does not trust client-supplied amounts.

Each Njia Smart line becomes a QuickBooks SalesItemLineDetail using the one shared Service item. It preserves:
- line description (item name and description),
- quantity,
- unit price,
- calculated line amount.

The same Service item is used for every line. Njia Smart does not send its own VAT amount or tax-code value. For non-US QuickBooks companies, the server reads the Service item's configured `SalesTaxCodeRef` and applies that same QuickBooks tax code to each line, with `GlobalTaxCalculation: TaxExcluded`. For US companies, the line taxable flag is derived from the Service item's taxable setting (TAX/NON); where sales tax is enabled, the mapped Customer's default tax code is used when available. US companies do not receive `GlobalTaxCalculation`.

**Tax implication:** because all lines use one shared Service item, all lines follow that item's QuickBooks tax defaults (subject to the Customer's tax settings). If a single Njia Smart invoice contains a mixture of standard-rated, exempt and zero-rated lines, this one-item setup will not preserve those separate line-level tax classifications. The shared QuickBooks item and customer tax settings must therefore be configured to match the intended invoice treatment before sending.

The invoice's currency must match the mapped QuickBooks Customer's currency (or the QuickBooks home currency). If the company has multicurrency enabled, the matching currency is explicitly supplied on the invoice. A mismatch is rejected rather than silently converting amounts.

## Duplicate protection and record linking

The local Njia Smart invoice UUID is used as the stable QuickBooks `requestid`. A successful QuickBooks invoice is linked through `integration_record_mappings` using the local invoice ID and external QuickBooks Invoice ID.

- Clicking Send again on an already linked invoice refreshes its QuickBooks status; it does not intentionally create another invoice.
- A retry after a network interruption reuses the same stable request ID.
- The QuickBooks invoice ID and document number are retained as the external link.
- QuickBooks invoice snapshots are stored in the existing server-only `integration_external_records` mirror.

No change to the live invoice schema or existing RLS policies is required for this workflow.

## Refreshing payment status

The **Refresh payment status** action reads the linked QuickBooks Invoice and displays:
- QuickBooks invoice number / ID,
- status: sent, partially paid, paid, overdue or voided when QuickBooks reports it,
- amount paid (QuickBooks TotalAmt less Balance),
- outstanding balance,
- last sync time,
- a link to open the invoice in the QuickBooks sandbox.

Njia Smart does not write the refreshed amounts or status back to its operational `invoices` or `payments` tables. Accounts continues to record and reconcile payments in QuickBooks.

## Permissions and safeguards

- The existing database-backed integration permission check governs view and sync actions.
- OAuth state is random, single-use and time-limited.
- Access and refresh tokens remain server-side in Supabase Vault.
- QuickBooks requests run only from server functions and use the sandbox API host.
- The invoice endpoint reads the invoice and items from the database and rejects draft/empty invoices.
- The request ID is stable per Njia Smart invoice.
- No service-role key or Intuit secret is sent to the browser.

## Verification checklist

Before accepting the workflow as production-ready:

1. Confirm the Preview Vercel deployment uses the intended Supabase staging project. Preview must not create test invoices in the production database.
2. Confirm `QBO_ENVIRONMENT=sandbox` and the callback URL matches Intuit's Development app configuration.
3. Connect a dedicated Intuit sandbox company.
4. Verify that the company has the correct home currency and multicurrency settings.
5. Configure one shared active QuickBooks Service item with the intended default tax treatment.
6. Match a Njia Smart test client to its correct QuickBooks Customer.
7. Send one finalised test invoice and compare line descriptions, quantities, unit prices, tax and total in QuickBooks.
8. Click Send again and confirm the same QuickBooks Invoice ID is returned.
9. Record a test payment directly in QuickBooks, refresh status in Njia Smart, and confirm the paid and outstanding amounts.
10. Confirm Njia Smart's own invoice and payment rows were not changed by the QuickBooks refresh.
11. Review Vercel build/runtime logs and Supabase security advisors.

A successful build alone does not prove OAuth, invoice creation, tax calculation or payment-status refresh has passed end-to-end testing.

## Official Intuit references

- [OAuth 2.0 authorization-code flow](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [QuickBooks Invoice create/read API](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice)
- [QuickBooks query syntax](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html)
- [QuickBooks invoice workflow](https://static.developer.intuit.com/output_html/qbo/docs/workflows/create-an-invoice.html)
