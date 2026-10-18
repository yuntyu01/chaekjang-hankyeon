# Optional Google and Kakao login

The server authenticates provider identities. No provider secret belongs in the Expo app, Git, public policies or logs. The existing book search key is separate from `KAKAO_LOGIN_REST_KEY`.

| Provider | Server variables | Fixed provider redirect |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://covebook.kodeploy.com/auth/google/callback` |
| Kakao | `KAKAO_LOGIN_REST_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_ADMIN_KEY`, `KAKAO_APP_ID` | `https://covebook.kodeploy.com/auth/kakao/callback` |

Set `PUBLIC_BASE_URL=https://covebook.kodeploy.com`. Use a Google **Web application** OAuth client, scopes `openid profile`; email is not collected. Kakao requests only the member identifier and optional nickname. Neither provider's profile pictures or access/refresh tokens are persisted. Google signature, issuer, audience, expiry, nonce and authorized party are checked using official JWKS. Matching email/name never links accounts.

The app starts login with its authenticated device token and `accountLifecycle: "1"`. Only `chaekjang://auth/google` or `chaekjang://auth/kakao` is accepted for app return; Expo Go cannot use this production flow. The HTTPS callback consumes the provider state, and an opaque single-use ticket is claimed using the starting device's token. Google tickets expire after two minutes; provider state after ten minutes. Hourly cleanup removes expired login rows. A device with an existing provider link cannot silently switch into a different linked account. Anonymous predecessor copies are tracked and erased with their target account.

Kakao Login remains disabled until its Admin key and app id are configured. The Admin key is used solely for authenticating the unlink webhook and disconnecting accounts that were deleted in Covebook. Configure GET or POST `https://covebook.kodeploy.com/auth/kakao/unlink` as the Kakao **unlink webhook**. Both its `Authorization: KakaoAK ...` header and `app_id` are checked. A verified unlink deletes the **whole Covebook server account**, including other linked providers and cloud records, rather than merely detaching one credential. Disclose this in app and public policy before activation.

## Account deletion and restore

`DELETE /me` requires the account's bearer token and `{ "confirmation": "DELETE" }`. The client pauses sync before requesting deletion. A minimal deletion intent is durably stored outside the SQL database in the existing private FileStore (`_account-deletions/`). Authentication checks it immediately. Background work deletes account rows and cascaded records, queues physical file removal and Kakao unlink, and retries failures. Logs use fixed messages without provider identifiers, keys or record contents. Kakao unlink jobs retain only the identifier needed for retries and expire within seven days with an error signal on deadline failure.

Deletion intents include account creation time to prevent deleting a new account that happens to reuse a numeric id. They remain for less than 30 days after DB deletion, and are reapplied **before web service startup** after a DB restore. Restore the database while retaining the newer independent private file store. Do not roll that journal back with a database snapshot. A restore older than the journal retention requires a separate audit; no host backup expiry has been verified by this code alone.

Local books/photos are intentionally retained after server deletion. A 401 response persistently pauses sync, including after restart; it never creates a replacement device account automatically. An explicit confirmation in Settings can create a new cloud account and upload local records again. A failed deletion request preserves its retry credential and remains paused. Existing old clients are required to update before starting a social login.

The file deletion queue retries physical removal. A persistent failure requires operator intervention; a timer alone does not guarantee a seven-day deletion deadline. Host/proxy log retention and hosting backup retention are separate configuration and must be verified before publishing a concrete guarantee.

## Verification

Run `gradlew.bat test --no-daemon` with Java 17 in `server`, and `npm run typecheck` plus `npm test -- --runInBand src/services/__tests__/sync-account-lifecycle.test.ts` in `app`. Integration tests use embedded isolated PostgreSQL, fake providers and temporary storage. Tests cover JWT rejection, ticket/state replay, authenticated deletion, immediate session rejection, physical file removal, predecessor deletion, restore reapplication, forged webhook rejection and sync pause persistence. Provider registration and real installed-app sign-in are separate checks.

Google button artwork is the unmodified approved light button. Sources: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Kakao REST](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [Kakao callbacks](https://developers.kakao.com/docs/ko/kakaologin/callback).
