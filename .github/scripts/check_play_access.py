"""Check Covebook Play access without uploading or committing a release.

The temporary edit is discarded even when reading tracks fails. Credentials and
tokens remain in memory and are never written to the report or error output.
"""
import json
import os
import sys
from urllib.parse import quote

PACKAGE = "app.covebook"
ACCOUNT = "covebook-play-deploy@gen-lang-client-0332508820.iam.gserviceaccount.com"
BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + PACKAGE


class AccessCheckError(Exception):
    pass


def credential_info(raw):
    try:
        info = json.loads(raw)
    except (ValueError, TypeError):
        raise AccessCheckError("PLAY_SERVICE_ACCOUNT_JSON is not valid JSON") from None
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise AccessCheckError("A service-account JSON credential is required")
    if info.get("client_email", "").strip().lower() != ACCOUNT:
        raise AccessCheckError("The configured service account is not the verified Covebook account")
    return info


def require_ok(response, operation):
    if response.status_code != 200:
        if response.status_code in (401, 403):
            raise AccessCheckError(
                f"Play access denied for {PACKAGE} during {operation} (HTTP {response.status_code}). "
                "Check the verified service account's app-specific view and testing-release permissions."
            )
        raise AccessCheckError(f"Play {operation} failed (HTTP {response.status_code})")


def check_access(session):
    response = session.post(BASE + "/edits", json={}, timeout=30)
    require_ok(response, "create edit")
    try:
        edit_id = response.json()["id"]
        if not isinstance(edit_id, str) or not edit_id:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise AccessCheckError("Play returned an invalid edit identifier") from None
    edit_url = BASE + "/edits/" + quote(edit_id, safe="")
    try:
        tracks_response = session.get(edit_url + "/tracks", timeout=30)
        require_ok(tracks_response, "read tracks")
        tracks = tracks_response.json().get("tracks", [])
        alpha = next((track for track in tracks if track.get("track") == "alpha"), None)
        if alpha is None:
            raise AccessCheckError("The existing alpha track was not found; check Console before building")
        report = {
            "package": PACKAGE,
            "serviceAccount": ACCOUNT,
            "accessVerified": True,
            "alpha": [
                {"versionCodes": release.get("versionCodes", []), "status": release.get("status")}
                for release in alpha.get("releases", [])
            ],
            "releaseUploaded": False,
            "releaseCommitted": False,
        }
    finally:
        cleanup = session.delete(edit_url, timeout=30)
        if cleanup.status_code not in (200, 204, 404):
            raise AccessCheckError(f"Could not discard the temporary Play edit (HTTP {cleanup.status_code})")
    report["temporaryEditDiscarded"] = True
    return report


def main():
    try:
        if os.environ.get("REQUESTED_PLAY_TRACK", "alpha") not in ("alpha", "beta", "internal"):
            raise AccessCheckError("This CI service account supports testing tracks only; production publishing is not configured")
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        credentials = service_account.Credentials.from_service_account_info(
            credential_info(os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "")),
            scopes=["https://www.googleapis.com/auth/androidpublisher"],
        )
        with AuthorizedSession(credentials) as session:
            report = check_access(session)
        text = json.dumps(report, ensure_ascii=False, indent=2)
        print(text)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write("### Covebook Play access preflight\n```json\n" + text + "\n```\n")
        return 0
    except AccessCheckError as error:
        print(str(error), file=sys.stderr)
    except Exception:
        # Do not dump request objects, authentication exceptions or credential data.
        print("Play access preflight failed before build; no credential details were logged", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
