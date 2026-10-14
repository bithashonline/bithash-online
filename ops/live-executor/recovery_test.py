import importlib.util,json,pathlib,sqlite3,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('recovery',pathlib.Path(__file__).with_name('recovery.py'));recovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(recovery)

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.tmp.name)
        for name in ['executor','shutdown','collector']:
            db=sqlite3.connect(self.base/(name+'.sqlite'))
            db.executescript("CREATE TABLE live_runs(state TEXT);CREATE TABLE live_fleets(state TEXT);CREATE TABLE own_range_jobs(target TEXT,start TEXT,next TEXT,state TEXT);INSERT INTO live_runs VALUES('deleted');INSERT INTO live_fleets VALUES('completed');INSERT INTO own_range_jobs VALUES('puzzle-71','1180591620717411303424','1180591620717414449152','completed');")
            db.commit();db.close()
        (self.base/'config').mkdir();(self.base/'config/config.json').write_text('{"fixture":"sensitive-test-value"}',encoding='utf8')
    def tearDown(self):self.tmp.cleanup()
    def snapshot(self):return recovery.snapshot(self.base/'executor.sqlite',self.base/'shutdown.sqlite',self.base/'collector.sqlite',self.base/'config',self.base/'recovery.zip')
    def test_snapshot_restores_committed_state_without_secret_output(self):
        result=self.snapshot();self.assertEqual(result['ledger']['checkpointedCandidates'],'3145728');self.assertTrue(result['restoreVerified']);self.assertFalse(result['executionEnabled']);self.assertNotIn('sensitive-test-value',json.dumps(result));self.assertEqual(recovery.verify_bundle(self.base/'recovery.zip'),result)
    def test_active_run_cannot_be_snapshotted(self):
        db=sqlite3.connect(self.base/'executor.sqlite');db.execute("UPDATE live_runs SET state='creating'");db.commit();db.close()
        with self.assertRaisesRegex(ValueError,'active_run_backup_blocked'):self.snapshot()
    def test_ambiguous_fleet_cannot_be_snapshotted(self):
        db=sqlite3.connect(self.base/'executor.sqlite');db.execute("UPDATE live_fleets SET state='unresolved'");db.commit();db.close()
        with self.assertRaisesRegex(ValueError,'active_fleet_backup_blocked'):self.snapshot()
    def test_existing_snapshot_cannot_be_overwritten(self):
        self.snapshot()
        with self.assertRaisesRegex(ValueError,'destination_exists'):self.snapshot()
    def test_modified_member_is_rejected_before_restore(self):
        self.snapshot()
        with zipfile.ZipFile(self.base/'recovery.zip') as z:parts={n:z.read(n) for n in z.namelist()}
        parts['configuration/config.json']=b'changed'
        with zipfile.ZipFile(self.base/'tampered.zip','w') as z:
            for n,data in parts.items():z.writestr(n,data)
        with self.assertRaisesRegex(ValueError,'archive_hash_mismatch'):recovery.verify_bundle(self.base/'tampered.zip')

if __name__=='__main__':unittest.main()
