# QuickBooks integration (company mirror, read-only)

Njia Smart connects to **one** QuickBooks Online company (G.K. Nahashon & Company). It only **reads**:
invoices, payments and balances. Nothing is ever written to QuickBooks, and the mirror never
overwrites Njia Smart invoices.

## Where it lives
Accounts → **QuickBooks** (`/accounts/quickbooks`).

- Connect / reconnect / disconnect: director or admin only.
- View and "Refresh from QuickBooks": director, admin, or roles with full Accounts access.

## How matching works
A QuickBooks invoice matches a Njia Smart invoice when QuickBooks `DocNumber` equals the Njia Smart
`invoice_number` (trimmed, case-insensitive). Each row shows one of:
matched, amount differs, paid status differs (QuickBooks paid = total − balance), or not in Njia Smart.
Non-draft Njia Smart invoices missing from QuickBooks are listed separately.
Comparisons are computed when the page loads; nothing is stored.

## Environment variables (Vercel)
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`
(`https://gk-nahashon.vercel.app/api/integrations/qbo/callback`, must match the Intuit app exactly,
no trailing slash) and `QBO_ENVIRONMENT` = `sandbox` or `production`.

## Going live
1. Test with Intuit sandbox keys and `QBO_ENVIRONMENT=sandbox`.
2. Add Intuit **production** keys, set `QBO_ENVIRONMENT=production`, redeploy.
3. Connect again (sandbox and production connections are kept separate).

## Data and security
Tokens are kept in Supabase Vault. Tables `qbo_invoices` and `qbo_payments` are server-only
(RLS on, no browser access). Disconnecting revokes the tokens and deletes the mirrored rows.
