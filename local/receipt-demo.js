import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReceiptStore, fetchReceipt, sample } from './receipts.js';
const dir = resolve('work/receipts'); mkdirSync(dir,{recursive:true});
const endpoint = process.argv[2];
// Optional endpoint reads only getTransaction/getSignatureStatuses. No send method.
const evidence = endpoint ? await fetchReceipt(endpoint,sample.signature) : {
  tx:JSON.parse(readFileSync(new URL('./fixtures/archived-fee-receipt.json',import.meta.url),'utf8')),
  provenance:{mode:'archived-rpc-unrefreshed',observedAt:'2026-10-02',source:'canonical project-memory/evidence/cobweb-deeper-www-2026-10-02/sol-result.json'}
};
const store = new ReceiptStore(resolve(dir,'observations.sqlite'));
try {
  const result=store.import(evidence.tx,evidence.provenance);
  const report=store.report();
  writeFileSync(resolve(dir,'fee-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({inserted:result.inserted,...report},null,2));
} finally {store.close();}
