import {config} from 'dotenv';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
config({quiet:true});
const url=new URL(process.env.DATABASE_URL);url.pathname='/marketsphere_test';
const env={...process.env,DATABASE_URL:url.toString()};
writeFileSync('.env.test',`DATABASE_URL=${url}\n`);
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','database/schema.prisma'],{env,stdio:'inherit'});process.exitCode=result.status;
