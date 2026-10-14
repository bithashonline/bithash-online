"""Private recovery snapshots. No provider calls, approval or execution paths."""
import argparse,hashlib,json,os,pathlib,sqlite3,tempfile,zipfile

TERMINAL_RUNS={'proposed','expired','rejected','cancelled','deleted','fleet_pending'}
TERMINAL_FLEETS={'proposed','expired','rejected','cancelled','failed','completed'}

def verify_executor(path):
    db=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('database_integrity_failed')
        if any(r[0] not in TERMINAL_RUNS for r in db.execute('SELECT state FROM live_runs')):raise ValueError('active_run_backup_blocked')
        if any(r[0] not in TERMINAL_FLEETS for r in db.execute('SELECT state FROM live_fleets')):raise ValueError('active_fleet_backup_blocked')
        jobs=db.execute('SELECT start,next,state FROM own_range_jobs WHERE target=?',('puzzle-71',)).fetchall()
        return {'rangeJobs':len(jobs),'checkpointedCandidates':str(sum(int(n)-int(s) for s,n,state in jobs if state!='private-review')),'runCount':db.execute('SELECT count(*) FROM live_runs').fetchone()[0]}
    finally:db.close()

def snapshot(executor,shutdown,collector,config_dir,destination):
    destination=pathlib.Path(destination)
    if destination.exists():raise ValueError('destination_exists')
    destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    before=verify_executor(executor)
    manifest={'schema':'bithash.private-recovery.v1','executionEnabled':False,'ledger':before,'files':[]}
    with tempfile.TemporaryDirectory(prefix='bithash-recovery-') as tmp:
        files=[]
        for name,path in [('executor.sqlite',executor),('shutdown.sqlite',shutdown),('collector.sqlite',collector)]:
            path=pathlib.Path(path)
            if not path.is_file():raise ValueError('required_database_missing')
            source=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True);target_path=pathlib.Path(tmp)/name;target=sqlite3.connect(target_path)
            try:
                source.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('snapshot_integrity_failed')
            finally:source.close();target.close()
            os.chmod(target_path,0o600);files.append((name,target_path.read_bytes()))
        if verify_executor(pathlib.Path(tmp)/'executor.sqlite')!=before or verify_executor(executor)!=before:raise ValueError('state_changed_during_snapshot')
        config_dir=pathlib.Path(config_dir)
        if not config_dir.is_dir():raise ValueError('configuration_missing')
        for path in sorted(config_dir.rglob('*')):
            if path.is_symlink():raise ValueError('configuration_symlink_rejected')
            if path.is_file():
                data=path.read_bytes()
                if len(data)>1048576:raise ValueError('configuration_too_large')
                files.append(('configuration/'+path.relative_to(config_dir).as_posix(),data))
        if not files or not any(n.startswith('configuration/') for n,d in files):raise ValueError('configuration_missing')
        for name,data in files:manifest['files'].append({'name':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
        fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as out:
            with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
                for name,data in files:z.writestr(name,data)
                z.writestr('manifest.json',json.dumps(manifest,separators=(',',':')))
    return verify_bundle(destination)

def verify_bundle(path):
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None:raise ValueError('archive_integrity_failed')
        names=z.namelist()
        if len(names)!=len(set(names)) or any(pathlib.PurePosixPath(n).is_absolute() or '..' in pathlib.PurePosixPath(n).parts for n in names):raise ValueError('unsafe_archive_path')
        manifest=json.loads(z.read('manifest.json'))
        if manifest.get('schema')!='bithash.private-recovery.v1' or manifest.get('executionEnabled') is not False:raise ValueError('invalid_recovery_manifest')
        if set(names)!={f['name'] for f in manifest['files']}|{'manifest.json'}:raise ValueError('archive_manifest_mismatch')
        for item in manifest['files']:
            data=z.read(item['name'])
            if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('archive_hash_mismatch')
        with tempfile.TemporaryDirectory(prefix='bithash-restore-check-') as tmp:
            # Verify a restored copy; never overwrite a live service database.
            for name in ('executor.sqlite','shutdown.sqlite','collector.sqlite'):
                target=pathlib.Path(tmp)/name;target.write_bytes(z.read(name));os.chmod(target,0o600)
                db=sqlite3.connect('file:'+str(target)+'?mode=ro',uri=True)
                try:
                    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('restored_database_invalid')
                finally:db.close()
            if verify_executor(pathlib.Path(tmp)/'executor.sqlite')!=manifest['ledger']:raise ValueError('restored_ledger_mismatch')
    data=pathlib.Path(path).read_bytes()
    return {'schema':'bithash.recovery-verification.v1','sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'files':len(manifest['files']),'ledger':manifest['ledger'],'restoreVerified':True,'executionEnabled':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    create=sub.add_parser('snapshot');create.add_argument('--executor',required=True);create.add_argument('--shutdown',required=True);create.add_argument('--collector',required=True);create.add_argument('--config-dir',required=True);create.add_argument('--destination',required=True)
    check=sub.add_parser('verify');check.add_argument('archive');args=parser.parse_args()
    try:
        result=snapshot(args.executor,args.shutdown,args.collector,args.config_dir,args.destination) if args.action=='snapshot' else verify_bundle(args.archive)
        print(json.dumps(result))
    except Exception as error:
        # Never print arbitrary paths, database contents, configuration or secrets.
        code=str(error) if isinstance(error,ValueError) else 'recovery_operation_failed'
        print(json.dumps({'error':code,'executionEnabled':False}));raise SystemExit(1)
