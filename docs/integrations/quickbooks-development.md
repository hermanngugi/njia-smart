# QuickBooks Online – development OAuth setup

This branch implements the QuickBooks Online OAuth 2.0 connection for **development sandbox companies only**. It does not yet synchronise accounting records.

## 1. Create the Intuit developer app

1. Open the [Intuit Developer Portal](https://developer.intuit.com/).
2. Create an app and select **QuickBooks Online Accounting**.
3. Open the app's **Development > Keys & OAuth** section.
4. Copy the Development Client ID and Client Secret.
5. Add the callback URL below under the app's Development redirect URIs.

Use the stable Vercel preview alias for this branch:

`https://gk-nahashon-git-integrations-foundation-hermanngugis-projects.vercel.app/api/integrations/qbo/callback`

The redirect URI must match exactly, including HTTPS, path and letter casing. Do not add query parameters or a trailing slash.

## 2. Configure Vercel Preview environment variables

In the Vercel project `gk-nahashon`, add these variables for the **Preview** environment:

| Variable | Value |
|---|---|
| `QBO_ENVIRONMENT` | `sandbox` |
| `QBO_CLIENT_ID` | Intuit Development Client ID |
| `QBO_CLIENT_SECRET` | Intuit Development Client Secret |
| `QBO_REDIRECT_URI` | The exact callback URL above |

Do not add a `VITE_` prefix to any of these values. They must remain server-side secrets. Do not put them in GitHub, source code or browser storage.

Redeploy the `integrations-foundation` Preview after setting the variables.

For local development, put the same variables in the repository-root `.env.local` file (this filename is ignored by Git) or supply them to the local Node.js process. Do not commit local secret files. Set `QBO_REDIRECT_URI` to the exact HTTPS callback URL registered in Intuit. Local OAuth testing therefore needs a trusted HTTPS tunnel whose callback is also registered with Intuit, or you can use the Vercel Preview URL.

## 3. Test the connection

1. Sign in to the Njia Smart Preview as a Director/Admin or an Accountant assigned to the test client.
2. Open the test client's profile and select **Integrations**.
3. Select **Connect QuickBooks**.
4. Sign in to a QuickBooks sandbox company and approve the Accounting scope.
5. Confirm that Njia Smart returns to the client profile and shows the connection as **Connected**.

The callback stores access and refresh tokens in Supabase Vault. The regular integration tables store only the Vault secret reference and token expiry metadata.

## 4. Current limitations

- Only the Intuit Development app keys and QuickBooks sandbox environment are supported.
- The scope is `com.intuit.quickbooks.accounting`.
- OAuth connection, token refresh, token revocation and disconnect are implemented.
- Customer, invoice and payment synchronisation is not yet implemented.
- No QuickBooks write operations are implemented.
- Production Intuit keys and Production redirects are deliberately rejected on this branch.

## 5. Troubleshooting

- **Configuration incomplete:** Check all four `QBO_*` Preview environment variables and redeploy.
- **Redirect URI mismatch / invalid_grant:** Compare Intuit's registered URI with `QBO_REDIRECT_URI` character-for-character.
- **State invalid or expired:** Start a new connection; OAuth state is single-use and expires after ten minutes.
- **Company already linked:** The same QuickBooks realm cannot be connected to a second Njia Smart client until the existing connection is disconnected.
- **Reconnect required:** Start the OAuth flow again. The app always saves the latest refresh token returned by Intuit.
