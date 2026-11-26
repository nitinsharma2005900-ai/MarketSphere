import bcrypt from 'bcryptjs';
import {db,redis,audit} from '../apps/backend/src/repository.js';
const email=process.env.ADMIN_EMAIL?.toLowerCase(),password=process.env.ADMIN_PASSWORD;
if(!email?.endsWith('@marketsphere.test')||!password||password.length<16)throw new Error('Set an owner-controlled synthetic ADMIN_EMAIL ending in @marketsphere.test and an ADMIN_PASSWORD of at least 16 characters in the private server environment');
const passwordHash=await bcrypt.hash(password,12);
const user=await db.$transaction(async tx=>{const u=await tx.user.upsert({where:{email},create:{email,name:'Marketplace Owner',role:'ADMIN',passwordHash},update:{role:'ADMIN',active:true,passwordHash}});await audit(tx,u.id,'ADMIN_BOOTSTRAPPED',u.id);return u;});
console.log(`Owner-controlled synthetic admin ready: ${user.email}`);await db.$disconnect();redis.disconnect();
