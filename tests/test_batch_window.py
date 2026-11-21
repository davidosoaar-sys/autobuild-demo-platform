import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from batch_window import batch_remaining_seconds


class BatchWindowTests(unittest.TestCase):
    def test_legacy_optimizer_requests_can_omit_batch_limits(self):
        self.assertIsNone(batch_remaining_seconds(None, None))

    def test_age_reduces_the_available_print_window(self):
        self.assertEqual(batch_remaining_seconds(15, 60), 2700)

    def test_partial_invalid_or_expired_batch_is_rejected(self):
        for age, limit in [(None, 60), (1, None), (60, 60), (-1, 60), (float('nan'), 60)]:
            with self.subTest(age=age, limit=limit), self.assertRaises(ValueError):
                batch_remaining_seconds(age, limit)
