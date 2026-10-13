import {generateKeyPairSync} from 'node:crypto';
import {SpendingApprovals,signApproval} from './spending-approvals.js';
// Ephemeral demonstration key, never written to disk. No network requests.
const keys=generateKeyPairSync('ed25519');
const db=new SpendingApprovals(':memory:',keys.publicKey.export({format:'pem',type:'spki'}));
try {
 const p={id:'demo-five-gpus',provider:'mock',destination:'synthetic-provider',gpu:'rtx-a5000',count:5,durationSeconds:3600,hourlyPerGpuMicrousd:'300000',overheadMicrousd:'100000',capMicrousd:'2000000',expiresAt:200};
 db.creditFixture('synthetic-fees','10000000',100);
 const digest=db.propose(p,101);
 const stages=[{stage:'fees-accumulated',balance:db.balance()}];
 db.approve(p.id,digest,signApproval(digest,keys.privateKey,db.ledgerId),102);
 stages.push({stage:'owner-approved',balance:db.balance()});
 db.beginSimulation(p.id,p,103);db.confirmSimulation(p.id,104);db.sweep(3703);
 stages.push({stage:'deadline-stop-requested',balance:db.balance()});
 db.settleSimulation(p.id,'1600000',3704);
 stages.push({stage:'synthetic-invoice-settled',balance:db.balance()});
 console.log(JSON.stringify({note:'Synthetic prices, funds, approval and provider outcomes; no actual AI, wallet or GPU execution.',stages,...db.snapshot()},null,2));
} finally {db.close()}
