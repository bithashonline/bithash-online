import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function controllerCredential(env=process.env) {
  if(env.CREDENTIALS_DIRECTORY){
    if(env.BITHASH_RUNPOD_CONTROLLER_KEY)throw Error('ambiguous_controller_credential');
    try {
      const key=readFileSync(join(env.CREDENTIALS_DIRECTORY,'runpod-key'),'utf8').trim();
      if(!key||key.length>4096||/\s/.test(key))throw Error();
      return key;
    } catch {throw Error('controller_credential_file_unavailable');}
  }
  return env.BITHASH_RUNPOD_CONTROLLER_KEY;
}
