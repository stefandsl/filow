// Run from the repository root after npm ci and build:welcome. Offline fakes only.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const cases=[
 ['pilot-metadata','apps/desktop/main.js','require("./package.json").updates !== false','true','apps/desktop/main.seams.test.ts'],
 ['pilot-loader','apps/desktop/main.js','if (updatesOff()) return false;','/* removed loader guard */','apps/desktop/main.seams.test.ts'],
 ['checkout-gate','apps/cloud/service.mjs',"if (url.pathname === '/v1/checkout' && !liveBilling)","if (false)",'apps/cloud/service.test.ts'],
 ['checkout-default','apps/cloud/service.mjs','liveBilling = false','liveBilling = true','apps/cloud/service.test.ts'],
 ['required-origin','tools/release/release-verify.mjs',"check(!requireAccountOrigin || (typeof pkg.accountOrigin === 'string' && pkg.accountOrigin.length > 0), 'accountOrigin is required for this release');","/* removed required origin */",'tools/release/test/release-verify.test.ts'],
 ['origin-allowlist','tools/release/release-verify.mjs','pkg.accountOrigin === undefined || origins.includes(pkg.accountOrigin)','true','tools/release/test/release-verify.test.ts'],
 ['caption-selection','apps/desktop/intro-captions.ts','track.language === lang','track.language === "en"','apps/desktop/intro-captions.test.ts'],
];
fs.mkdirSync('tmp/safe-prep', {recursive:true});
const results=[];
for(const [name,file,from,to,test] of cases){
 const original=fs.readFileSync(file,'utf8');if(!original.includes(from))throw Error('Missing mutation '+name);
 try{
  fs.writeFileSync(file,original.replace(from,to));
  const report='tmp/safe-prep/mutation-'+name+'.json';
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',test,'--maxWorkers=2','--reporter=json','--outputFile='+report],{windowsHide:true,timeout:60000,encoding:'utf8'});
  const data=JSON.parse(fs.readFileSync(report,'utf8'));const killed=r.status===1&&data.numFailedTests>0;
  results.push({name,killed,failed:data.numFailedTests});console.log(name,killed,data.numFailedTests);
  if(!killed)throw Error('Survived '+name);
 }finally{fs.writeFileSync(file,original);fs.writeFileSync('tmp/safe-prep/mutations.json',JSON.stringify(results,null,2));}
}
