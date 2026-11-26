import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
mkdirSync('docs/evidence/checks',{recursive:true});
const checks=[
  ['backend-build',['node_modules/typescript/bin/tsc','--project','apps/backend/tsconfig.json']],
  ['frontend-typecheck',['node_modules/typescript/bin/tsc','--project','apps/frontend/tsconfig.json','--noEmit']],
  ['lint',['node_modules/eslint/bin/eslint.js','apps','database','tests','--max-warnings','0']],
  ['frontend-build',[path.join(root,'node_modules/next/dist/bin/next'),'build'],path.join(root,'apps/frontend')]
];
const results=[];
for(const [name,args,cwd] of checks){const started=Date.now();const result=spawnSync(process.execPath,args,{cwd:cwd??root,encoding:'utf8',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},maxBuffer:20*1024*1024});writeFileSync(`docs/evidence/checks/${name}.log`,(result.stdout??'')+(result.stderr??''));results.push({name,exitCode:result.status,passed:result.status===0,elapsedSeconds:(Date.now()-started)/1000});console.log(`${name}: ${result.status===0?'PASS':'FAIL'}`);}
writeFileSync('docs/evidence/build-results.json',JSON.stringify({executedAt:new Date().toISOString(),checks:results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
