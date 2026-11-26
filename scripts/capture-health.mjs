import {config} from 'dotenv';
import {writeFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
config({quiet:true});
const db=new PrismaClient();
const urls=['http://localhost:3040','http://localhost:4040/health','http://localhost:4040/ready','http://localhost:4040/api-docs/','http://localhost:8040/health','http://localhost:9040/minio/health/live','http://localhost:8025/api/v1/messages','http://localhost:3050','http://localhost:4050/ready','http://localhost:8050/health'];
const services=[];
for(const url of urls){try{const result=await fetch(url,{signal:AbortSignal.timeout(10000)});services.push({url,status:result.status,...(url.endsWith('/ready')?{details:await result.json()}:{})});}catch(e){services.push({url,status:'unavailable',error:e.message});}}
const counts={users:await db.user.count(),sellers:await db.seller.count(),products:await db.product.count(),variants:await db.variant.count(),warehouses:await db.warehouse.count(),orders:await db.order.count(),stockMovements:await db.stockMovement.count(),refunds:await db.refund.count()};
writeFileSync('docs/evidence/service-health.json',JSON.stringify({executedAt:new Date().toISOString(),services,counts},null,2));console.log(JSON.stringify({services,counts},null,2));await db.$disconnect();
