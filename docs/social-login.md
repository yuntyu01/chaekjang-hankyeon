# Optional Google and Kakao login

The server authenticates provider identities. No provider secret belongs in the Expo app, Git, public policies or logs. The existing book search key is separate from `KAKAO_LOGIN_REST_KEY`.

| Provider | Server variables | Fixed provider redirect |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://covebook.kodeploy.com/auth/google/callback` |
| Kakao | `KAKAO_LOGIN_REST_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_ADMIN_KEY`, `KAKAO_APP_ID` | `https://covebook.kodeploy.com/auth/kakao/callback` |

Set `PUBLIC_BASE_URL=https://covebook.kodeploy.com`. Use a Google **Web application** OAuth client, scopes `openid profile`; email is not collected. Kakao requests only the member identifier and optional nickname. Neither provider's profile pictures or access/refresh tokens are persisted. Google signature, issuer, audience, expiry, nonce and authorized party are checked using official JWKS. Matching email/name never links accounts.

The app starts login with its authenticated device token and `accountLifecycle: "1"`. Only `chaekjang://auth/google` or `chaekjang://auth/kakao` is accepted for app return; Expo Go cannot use this production flow. The HTTPS callback consumes the provider state, and an opaque single-use ticket is claimed using the starting device's token. Google tickets expire after two minutes; provider state after ten minutes. Expired login rows are removed when a login is started. A device with an existing provider link cannot silently switch into a different linked account. Anonymous predecessor copies are tracked and erased with their target account.

Kakao Login remains disabled until its Admin key and app id are configured. The Admin key is used solely for authenticating the unlink webhook and disconnecting accounts that were deleted in Covebook. Configure GET or POST `https://covebook.kodeploy.com/auth/kakao/unlink` as the Kakao **unlink webhook**. Both its `Authorization: KakaoAK ...` header and `app_id` are checked. A verified unlink removes the Kakao identity only; the Covebook account and reading records remain until the user explicitly requests account deletion.

## Account deletion and restore

`DELETE /me` requires the account's bearer token and `{ "confirmation": "DELETE" }`. The client pauses sync before requesting deletion. A minimal deletion intent, including a hash of the requesting token for idempotent retries, is durably stored outside the SQL database in the existing private FileStore (`_account-deletions/`). Tokens are revoked after the journal is saved. Background work deletes account rows and cascaded records, queues physical file removal and Kakao unlink, and retries failures. Logs use fixed messages without provider identifiers, keys or record contents. Kakao unlink jobs retain only the identifier needed for retries; jobs that remain after seven days raise an operator alert and continue retrying until resolved.

Deletion intents include account creation time to prevent deleting a new account that happens to reuse a numeric id. They remain for less than 30 days after DB deletion, and are reapplied **before web service startup** after a DB restore. Restore the database while retaining the newer independent private file store. Do not roll that journal back with a database snapshot. A restore older than the journal retention requires a separate audit; no host backup expiry has been verified by this code alone.

Local books/photos are intentionally retained after server deletion. A 401 response persistently pauses sync, including after restart; it never creates a replacement device account automatically. An explicit confirmation in Settings can create a new cloud account and upload local records again. A failed deletion request preserves its retry credential and remains paused. Existing old clients are required to update before starting a social login.

The file deletion queue retries physical removal, including unregistered objects in the user's storage prefix. A persistent failure requires operator intervention; a timer alone does not guarantee a seven-day deletion deadline. Host/proxy log retention and hosting backup retention are separate configuration and must be verified before publishing a concrete guarantee. R2 credentials require list, read, write and delete access to the private bucket and deletion journal. Do not roll back this journal with an older database backup.

## Rollout

- In Google Cloud Console, use a Web application OAuth client and register `https://covebook.kodeploy.com/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL` on the server only.
- Apply migrations V6 and V7 using Flyway on existing Flyway-managed databases before starting the Go server. Go-managed databases apply V6 and V7 themselves; never point tests at the production database.
- Deploy the server before enabling the app feature. `/auth/providers` reports which providers are configured; missing credentials keep the corresponding button hidden. The production OAuth flow requires an installed build, not Expo Go.
- Older app versions can automatically recreate a device account after a token is revoked. Update all devices before requesting deletion; records retained on an old device can otherwise be uploaded again as a new account.

## Verification

Run `go test ./...` in `server`, setting `TEST_DATABASE_URL` to a disposable PostgreSQL database for integration tests, and `npm run typecheck` plus `npm test -- --runInBand src/services/__tests__/sync-account-lifecycle.test.ts` in `app`. Integration tests use isolated PostgreSQL, fake providers and temporary storage. Tests cover JWT rejection, ticket/state replay, authenticated deletion, immediate session rejection, physical file removal, predecessor deletion, restore reapplication, forged webhook rejection and sync pause persistence. Provider registration and real installed-app sign-in are separate checks.

Google button artwork is the unmodified approved light button. Sources: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Kakao REST](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [Kakao callbacks](https://developers.kakao.com/docs/ko/kakaologin/callback).
