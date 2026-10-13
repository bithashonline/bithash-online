import { observeTarget, assessTarget } from './target-evidence.js';
const observations = await observeTarget();
console.log(JSON.stringify({ observations, assessment: assessTarget(observations) }, null, 2));
