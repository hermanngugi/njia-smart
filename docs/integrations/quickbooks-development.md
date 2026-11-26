# QuickBooks Online – sandbox OAuth and API examples

This branch contains a server-side QuickBooks Online OAuth 2.0 authorization-code integration for Intuit's **Development sandbox**. It uses the existing Njia Smart client integration permissions and stores OAuth credentials in Supabase Vault.

## 1. Intuit Developer app setup

In the Intuit Developer Portal, open your app and check **Development > Keys & OAuth**.

Enable the APIs/scopes required by this example:

- `com.intuit.quickbooks.accounting`
- `com.intuit.quickbooks.payment`
- `openid`
- `profile`
- `email`
- `phone`
- `address`

These are the same combined Accounting, Payments and OpenID scopes used by Intuit's official Node.js OAuth 2.0 sample. The app must also have access to the QuickBooks Payments API in its sandbox configuration.

### Njia Smart redirect URI

For Njia Smart, register the application's callback—not the Intuit Quickstart page—as a redirect URI:

`https://gk-nahashon-git-integrations-foundation-hermanngugis-projects.vercel.app/api/integrations/qbo/callback`

The value supplied in the Quickstart form, `https://developer.intuit.com/app/developer/quickstart`, is not the Njia Smart callback route. OAuth requires the redirect URI in the authorization request, token exchange, and Intuit app settings to match exactly. Use the Njia Smart callback above for the Preview integration.

Do not add a trailing slash, query string, or different path. For a local callback, use an HTTPS tunnel and register that exact tunnel callback URL in Intuit as well.

## 2. Environment variables

Set these in the **Preview** environment of the Vercel project, and in the repository-root `.env.local` for local development:

```dotenv
QBO_ENVIRONMENT=sandbox
QBO_CLIENT_ID=your_Intuit_Development_Client_ID
QBO_CLIENT_SECRET=your_Intuit_Development_Client_Secret
QBO_REDIRECT_URI=https://gk-nahashon-git-integrations-foundation-hermanngugis-projects.vercel.app/api/integrations/qbo/callback
```

Use the Client ID supplied for your Intuit app. Obtain the Client Secret from **Development > Keys & OAuth** and set it directly in Vercel or the ignored local `.env.local` file. Never commit it, send it in chat, place it in `VITE_*` variables, or expose it to browser code.

For local OAuth, the redirect URI must point to a public HTTPS callback that reaches the local Njia Smart server, and that exact URL must be registered in Intuit. Otherwise, test OAuth on the Vercel Preview environment.

## 3. Run Njia Smart locally

The project uses Node.js 20 or later.

1. Install the repository dependencies from the project root:

   ```bash
   npm install
   ```

2. Configure the regular Njia Smart Supabase environment variables in your local environment, as well as the four `QBO_*` variables above.
3. Start the development server:

   ```bash
   npm run dev
   ```

4. Sign in to Njia Smart, open a client profile, and select **Integrations**.
5. Select **Connect QuickBooks**, sign in with a QuickBooks sandbox company, and consent to the requested scopes.

The OAuth authorization-code flow uses a cryptographically random, single-use state value. The callback checks that state, exchanges the code once, and stores the access and refresh tokens in Supabase Vault. The regular integration table contains connection metadata and expiry timestamps, not the raw tokens.

## 4. Run the API examples

After the sandbox company shows **Connected**, use the **Sandbox API examples** section in that client's Integrations tab.

### Company information – QuickBooks Accounting

The **Get company info** button sends:

```http
GET https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/companyinfo/{realmId}
Authorization: Bearer {access_token}
Accept: application/json
```

The realm ID is taken from the authenticated company's existing Njia Smart integration record; it is not accepted from the browser.

### OpenID Connect user information

The **Get OpenID user info** button sends:

```http
GET https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo
Authorization: Bearer {access_token}
Accept: application/json
```

This requires the OpenID scopes listed in Section 1. The result is displayed for the authorised staff member and is not stored as a Njia Smart client record.

### Payments – create a sandbox charge

The **Payments sandbox charge** form accepts an Intuit one-time payment token, amount in USD, and whether to capture immediately.

Intuit's documented flow is:

1. The customer's payment details are tokenised using the Payments API from the browser. The browser receives an opaque token; Njia Smart should not receive or store the card number or CVC.
2. Submit that one-time token from the server to the Charges endpoint.
3. If the charge was created with capture disabled, capture the authorised charge with the returned charge ID.

The Intuit payment token is single-use and expires after 15 minutes. Obtain it through Intuit's approved client-side tokenisation flow or sandbox tooling, then paste only the opaque token into Njia Smart.

The charge request is based on Intuit's Payments guide:

```http
POST https://sandbox.api.intuit.com/quickbooks/v4/payments/charges
Authorization: Bearer {access_token}
Content-Type: application/json
Accept: application/json
Request-Id: {unique-request-id}

{
  "amount": "1.00",
  "currency": "USD",
  "capture": "false",
  "token": "{one-time-payment-token}"
}
```

- With **Capture immediately** unchecked, Intuit creates an authorisation. The form offers **Capture authorised charge** after an `AUTHORIZED` response.
- With **Capture immediately** checked, the charge request is sent with `capture: "true"`.
- Payment submission and capture are restricted to Director/Admin users by the database-backed integration permission check.
- A unique `Request-Id` is generated for each operation. The response displayed in Njia Smart deliberately omits the payment token.

The separate capture call uses the charge ID and amount returned by the authorisation:

```http
POST https://sandbox.api.intuit.com/quickbooks/v4/payments/charges/{chargeId}/capture
Authorization: Bearer {access_token}
Content-Type: application/json
Accept: application/json
Request-Id: {unique-request-id}

{ "amount": "1.00" }
```

The charge form is for sandbox verification only. No production Payments endpoint or production credential is enabled on this branch.

## 5. Token refresh and error handling

- The server checks the stored access-token expiry before each API call.
- When an access token is near expiry, the server refreshes it using the latest refresh token and stores the rotated token bundle in Supabase Vault.
- If an API call returns HTTP 401, the server forces one refresh and retries the request once. Payment retries reuse the same `Request-Id`.
- Intuit error responses are reduced to the HTTP status and provider error code. Raw provider payloads and token material are not logged or returned.
- Intuit refresh tokens rotate. Always use the most recently returned refresh token; reauthorisation is required when the refresh token expires or is revoked.

## 6. Permissions and current limits

- Director/Admin: connect, disconnect, view API examples, create and capture sandbox payment charges.
- Accountant: connect and view assigned-client API examples.
- Audit Manager/Tax Consultant: view-only where the client assignment and integration permission check allow it.
- Other roles: no integration access.

Implemented on this branch: OAuth authorization-code flow, single-use state, Vault-backed token storage, token refresh/revocation, CompanyInfo, OpenID userinfo, and sandbox charge/authorisation capture examples.

Not implemented: bulk customer/invoice/payment synchronisation, production credentials, production Payments calls, and general accounting write operations. The API examples do not start a background synchronisation job or save returned provider records.

## Official Intuit references

- [OAuth 2.0 setup and authorization-code flow](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Intuit Developer official Node.js OAuth 2.0 sample](https://github.com/IntuitDeveloper/oauth2-nodejs)
- [Process a payment – Payments API workflow](https://developer.intuit.com/app/developer/qbpayments/docs/workflows/process-a-payment)
- [CompanyInfo API reference](https://developer.intuit.com/docs/api/accounting/CompanyInfo)
