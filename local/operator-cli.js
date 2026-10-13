import {dashboardSnapshot} from './dashboard-api.js';
import {localOperator,modelOperator} from './operator.js';
const [mode,db,...extra]=process.argv.slice(2);
try{
 if(!['preview','model'].includes(mode)||!db||extra.length)throw Error('usage: operator-cli.js preview|model DATABASE');
 const snapshot=dashboardSnapshot(db);
 const result=mode==='preview'?localOperator(snapshot):await modelOperator(snapshot,{apiKey:process.env.BITHASH_OPERATOR_API_KEY,model:process.env.BITHASH_OPERATOR_MODEL});
 console.log(JSON.stringify(result,null,2));
}catch{console.error(JSON.stringify({error:'operator_review_unavailable',executionEnabled:false}));process.exitCode=1;}
