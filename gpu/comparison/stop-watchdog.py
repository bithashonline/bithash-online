"""Best-effort own-Pod stop after 20 minutes; no credential values are logged.

This is an in-Pod fallback, not an independent provider-side spending guarantee.
The operator must still check startup time, stop/delete and reconcile billing.
"""
import os,re,time,urllib.request,sys

def own_pod_request():
    pod=os.environ.get('RUNPOD_POD_ID','')
    key=os.environ.get('RUNPOD_API_KEY','')
    if not re.fullmatch('[a-z0-9]{10,32}',pod) or not key:
        raise ValueError('Pod-scoped stop credentials unavailable')
    return urllib.request.Request('https://rest.runpod.io/v1/pods/'+pod+'/stop',
        data=b'',method='POST',headers={'Authorization':'Bearer '+key})

if __name__=='__main__':
    request=own_pod_request()
    print('WATCHDOG ARMED: own Pod stop in 1200 seconds',flush=True)
    time.sleep(1200)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request,timeout=15) as response:
                if response.status in [200,204]:sys.exit(0)
        except Exception:
            print('WATCHDOG stop attempt failed; operator must verify',flush=True)
        time.sleep(5)
    sys.exit(1)
