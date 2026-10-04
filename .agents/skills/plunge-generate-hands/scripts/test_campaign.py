import hashlib
import importlib.util
import json
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('campaign', Path(__file__).with_name('campaign.py'))
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)


class CampaignChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / 'manifest.json').write_text(json.dumps({'hands': 4, 'seed_start': 100, 'profile': 'test'}))
        with sqlite3.connect(self.source / 'played.sqlite') as db:
            db.execute('CREATE TABLE hands(id,seed,seat)')
            db.executemany('INSERT INTO hands VALUES (?,?,?)', [(i, 100, i) for i in range(4)])
            db.execute('CREATE TABLE games(id)')
            db.execute('INSERT INTO games VALUES (1)')
        self.book = self.root / 'book.json'
        self.book.write_text(json.dumps({'schema': 'plunge-played-bids-v1', 'seeds': [100], 'games': 1, 'profile': 'test'}))

    def test_plan_derives_four_seat_counts_and_disjoint_seeds(self):
        plan = campaign.inspect(self.source, self.book, 2)
        self.assertEqual(plan['target_hands'], 12)
        self.assertEqual(plan['new_seeds'], [101, 102])
        with self.assertRaises(ValueError):
            campaign.inspect(self.source, self.book, 0)

    def test_mismatched_catalogue_is_rejected(self):
        with sqlite3.connect(self.source / 'played.sqlite') as db:
            db.execute('UPDATE hands SET seed=101 WHERE id=3')
        with self.assertRaisesRegex(ValueError, 'identities'):
            campaign.inspect(self.source, self.book, 1)

    def test_frozen_source_change_is_rejected(self):
        research = self.root / 'research'
        research.mkdir()
        source = research / 'source.txt'
        source.write_text('frozen')
        binary = self.root / 'binary'
        binary.write_bytes(b'fixture, never executed')
        identity = {'binary_sha256': campaign.sha(binary), 'sources': {'source.txt': campaign.sha(source)}}
        producer = hashlib.sha256(campaign.canonical(identity).encode()).hexdigest()
        folder = self.source / 'producers' / producer
        folder.mkdir(parents=True)
        (folder / 'kiln-play-worker').write_bytes(binary.read_bytes())
        with tarfile.open(folder / 'source.tar.gz', 'w:gz') as archive:
            archive.add(source, arcname='source.txt')
        info = dict(identity, schema='kiln-played-producer-v2', bundle_id=producer,
                    archive_sha256=campaign.sha(folder / 'source.tar.gz'))
        (folder / 'producer.json').write_text(json.dumps(info))
        campaign.verify_producer(self.source, producer, research)
        source.write_text('mutated')
        with self.assertRaisesRegex(ValueError, 'source mismatch'):
            campaign.verify_producer(self.source, producer, research)


if __name__ == '__main__':
    unittest.main()
