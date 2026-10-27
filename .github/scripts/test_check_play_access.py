import json
import unittest
from unittest.mock import Mock

from check_play_access import ACCOUNT, BASE, AccessCheckError, check_access, credential_info


def response(status, body=None):
    result = Mock(status_code=status)
    result.json.return_value = body
    return result


class PlayAccessTests(unittest.TestCase):
    def session(self):
        session = Mock()
        session.post.return_value = response(200, {"id": "12345"})
        session.get.return_value = response(200, {"tracks": [{"track": "alpha", "releases": [{"versionCodes": ["956153"], "status": "completed"}]}]})
        session.delete.return_value = response(204)
        return session

    def test_success_reads_alpha_then_discards_without_commit(self):
        session = self.session()
        result = check_access(session)
        self.assertEqual(result["alpha"][0]["versionCodes"], ["956153"])
        self.assertTrue(result["temporaryEditDiscarded"])
        self.assertFalse(result["releaseCommitted"])
        session.post.assert_called_once_with(BASE + "/edits", json={}, timeout=30)
        session.get.assert_called_once_with(BASE + "/edits/12345/tracks", timeout=30)
        session.delete.assert_called_once_with(BASE + "/edits/12345", timeout=30)

    def test_denied_access_does_not_read_or_create_another_edit(self):
        session = self.session()
        session.post.return_value = response(403, {"private": "do not expose response content"})
        with self.assertRaisesRegex(AccessCheckError, "HTTP 403") as error:
            check_access(session)
        self.assertNotIn("private", str(error.exception))
        session.get.assert_not_called()
        session.delete.assert_not_called()

    def test_track_error_still_discards_edit(self):
        session = self.session()
        session.get.return_value = response(403)
        with self.assertRaisesRegex(AccessCheckError, "read tracks"):
            check_access(session)
        session.delete.assert_called_once()

    def test_missing_alpha_does_not_continue_to_build(self):
        session = self.session()
        session.get.return_value = response(200, {"tracks": []})
        with self.assertRaisesRegex(AccessCheckError, "alpha track was not found"):
            check_access(session)
        session.delete.assert_called_once()

    def test_cleanup_failure_is_not_reported_as_success(self):
        session = self.session()
        session.delete.return_value = response(503)
        with self.assertRaisesRegex(AccessCheckError, "discard"):
            check_access(session)

    def test_wrong_identity_fails_without_exposing_json(self):
        with self.assertRaisesRegex(AccessCheckError, "not the verified") as error:
            credential_info(json.dumps({"type": "service_account", "client_email": "other@example.test", "private_key": "DO-NOT-LOG"}))
        self.assertNotIn("DO-NOT-LOG", str(error.exception))
        self.assertEqual(credential_info(json.dumps({"type": "service_account", "client_email": ACCOUNT}))["client_email"], ACCOUNT)


if __name__ == "__main__":
    unittest.main()
