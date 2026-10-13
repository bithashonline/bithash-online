// In-memory simulation. Amounts are integer micro-USD, never real treasury funds.
export const RATE = 740000, RUNWAY = 6, MAX_RIGS = 4;
export function initial() { return { fees:0, compute:0, other:0, spent:0, reserved:0, minute:0, rigs:[], events:[] }; }
function event(s, kind, detail) { s.events.unshift({id:`SIM-${s.events.length+1}`,minute:s.minute,kind,detail}); }
export function fund(s, amount) {
  if (!Number.isSafeInteger(amount) || amount<=0 || amount>1000000000 || s.fees+amount>1000000000000) throw Error('Invalid test amount');
  s.fees+=amount; s.compute=Math.floor(s.fees*4/5); s.other=s.fees-s.compute;
  event(s,'Fee fixture',`${amount} micro-USD received; cumulative 80% allocation.`); scale(s);
}
export function scale(s) {
  while(s.rigs.filter(r=>r.status!=='stopped').length<MAX_RIGS && available(s)>=RATE*RUNWAY) {
    const r={id:`GPU-${String(s.rigs.length+1).padStart(2,'0')}`,status:'starting',remaining:RATE*RUNWAY,spent:0,heartbeat:null,work:0};
    s.rigs.push(r); s.reserved+=r.remaining;
    event(s,'Rental reservation',`${r.id}: six-hour test budget reserved; awaiting simulated provider confirmation.`);
  }
}
export function available(s) { return s.compute-s.spent-s.reserved; }
export function advance(s) {
  s.minute+=15;
  for(const r of s.rigs) {
    if(r.status==='stopped') continue;
    if(r.status==='unknown') { event(s,'Reconciliation required',`${r.id}: reservation retained; no duplicate creation.`); continue; }
    if(r.status==='stale') { event(s,'Termination confirmed',`${r.id}: simulated termination; unused reservation released.`); s.reserved-=r.remaining;r.remaining=0;r.status='stopped'; continue; }
    r.status='running'; const cost=Math.min(r.remaining,RATE/4); r.remaining-=cost;r.spent+=cost;s.spent+=cost;s.reserved-=cost;r.work+=1;r.heartbeat=s.minute;
    event(s,'Worker report',`${r.id}: fixture checkpoint ${r.work}; reported, not independently attested.`);
    if(r.remaining===0) { r.status='stopped';event(s,'Budget stop',`${r.id}: six-hour lease exhausted; simulated termination confirmed.`); }
  }
}
export function fault(s,id,kind) {
  const r=s.rigs.find(x=>x.id===id);if(!r || r.status==='stopped' || !['stale','unknown'].includes(kind)) throw Error('Invalid rig transition');
  r.status=kind;event(s,'Attention',`${id}: ${kind==='stale'?'heartbeat missing; termination queued':'provider outcome unknown; reconciliation required'}.`);
}
