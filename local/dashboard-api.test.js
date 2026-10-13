import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dashboardSnapshot, handleDashboardApi } from './dashboard-api.js';

test('dashboard never represents local fixture jobs as live GPU rentals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bithash-api-')); const p=join(dir,'fixture.db');
 try { const db=new DatabaseSync(p);db.exec("CREATE TABLE jobs(id TEXT,fixture TEXT,status TEXT,start TEXT,end TEXT,next TEXT,epoch INTEGER,expires INTEGER,secret TEXT); CREATE TABLE checkpoints(job TEXT); INSERT INTO jobs VALUES ('private-job','puzzle-3','running','4','8','6',1,30,'do-not-expose'), ('private-job-2','puzzle-2','injected-secret','2','4','2',0,0,'hidden'); INSERT INTO checkpoints VALUES ('private-job');");db.close();
 const value=dashboardSnapshot(p,0);assert.equal(value.fixtures.jobs,2);assert.equal(value.fixtures.states.running,1);assert.equal(value.fixtures.states.other,1);assert.equal(value.fixtures.checkpoints,1);assert.deepEqual(value.live.rigs,[]);assert.equal(JSON.stringify(value).includes('secret'),false);assert.equal(JSON.stringify(value).includes(dir),false);
 assert.equal(JSON.stringify(value).includes('private-job'),false);assert.deepEqual(value.fixtures.items[0].progress,{completed:'2',total:'4'});assert.equal(value.fixtures.items[0].lease.freshness,'fresh');assert.equal(dashboardSnapshot(p,30000).fixtures.items[0].lease.freshness,'stale');assert.equal(value.fixtures.items[0].gpuVerified,false);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('missing or malformed database degrades without exposing paths or creating a database',()=>{assert.equal(dashboardSnapshot().fixtures.status,'not-configured');assert.equal(dashboardSnapshot('Z:/does-not-exist/private.db').fixtures.status,'unavailable')});
test('API rejects mutation and does not accept database selection from query',()=>{let body;const res={setHeader(){},writeHead(n){this.status=n},end(s){body=s}};assert.equal(handleDashboardApi({method:'POST',url:'/api/status'},res),true);assert.equal(res.status,405);handleDashboardApi({method:'GET',url:'/api/status?databasePath=secret.db'},res);assert.equal(JSON.parse(body).fixtures.status,'not-configured');assert.equal(handleDashboardApi({method:'GET',url:'/other'},res),false)});
