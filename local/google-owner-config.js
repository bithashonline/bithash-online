import fs from 'node:fs';

// This path must live outside the public checkout and static web root.
export function loadGoogleOwnerConfig(setupPath) {
 const setup=JSON.parse(fs.readFileSync(setupPath,'utf8'));
 const clientId=setup.googleClientId, identityPath=setupPath+'.identity.json';
 if(typeof clientId!=='string'||!clientId.endsWith('.apps.googleusercontent.com'))throw Error('invalid_google_client');
 let ownerSub;
 try {
  const identity=JSON.parse(fs.readFileSync(identityPath,'utf8'));
  if(identity.clientId!==clientId||!/^\d{1,255}$/.test(identity.sub??''))throw Error('invalid_owner_identity');
  ownerSub=identity.sub;
 } catch(error) {if(error.code!=='ENOENT')throw error;}
 return {clientId,ownerSub,enrollmentEmail:ownerSub?undefined:setup.intendedOwnerEmail,
  persistOwner:({sub,clientId:verifiedClient})=>{
   if(verifiedClient!==clientId||!/^\d{1,255}$/.test(sub??''))throw Error('invalid_owner_identity');
   // Exclusive creation prevents concurrent enrollments or restarts from replacing an owner.
   const fd=fs.openSync(identityPath,'wx',0o600);
   try{fs.writeFileSync(fd,JSON.stringify({sub,clientId,enrolledAt:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }};
}
