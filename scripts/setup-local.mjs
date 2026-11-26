import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
if (!existsSync('.env')) {
  let env = readFileSync('.env.example','utf8');
  const password=randomBytes(24).toString('hex');
  env=env.replaceAll('CHANGE_ME_LOCAL_ONLY','MarketSphere!2026').replaceAll('CHANGE_ME',password);
  env=env.replace(/GENERATE_AT_LEAST_32_RANDOM_BYTES|GENERATE_A_DIFFERENT_RANDOM_SECRET|GENERATE_LOCAL_ACCESS_KEY|GENERATE_LOCAL_SECRET/g,()=>randomBytes(32).toString('hex'));
  writeFileSync('.env',env,{mode:0o600});
}
mkdirSync('.runtime',{recursive:true});
console.log('Local configuration ready. Secrets are stored only in ignored .env.');
