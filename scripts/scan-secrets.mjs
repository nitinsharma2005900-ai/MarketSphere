import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parse} from 'dotenv';
const env=parse(readFileSync('.env'));
const actualSecrets=Object.entries(env).filter(([name,value])=>/SECRET|PASSWORD|TOKEN|ACCESS_KEY/.test(name)&&name!=='DEMO_PASSWORD'&&value.length>=16);
const files=spawnSync('git',['ls-files','-z'],{encoding:'utf8'}).stdout.split('\0').filter(Boolean);
const findings=[];
for(const path of files){if(/\.(png|pdf|zip)$/.test(path))continue;let body;try{body=readFileSync(path,'utf8');}catch{continue;}for(const [variable,value] of actualSecrets)if(body.includes(value))findings.push({path,variable});}
const result={executedAt:new Date().toISOString(),trackedFiles:files.length,localSecretValuesChecked:actualSecrets.length,passed:findings.length===0,findings};
writeFileSync('docs/evidence/secret-scan.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(findings.length)process.exitCode=1;
