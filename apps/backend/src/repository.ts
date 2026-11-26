import { PrismaClient,Prisma } from '@prisma/client';
import { Redis } from 'ioredis';
import pino from 'pino';
import {config} from './config.js';
export const db=new PrismaClient();
export const redis=new Redis(config.REDIS_URL,{maxRetriesPerRequest:null,lazyConnect:true});
export const logger=pino({level:process.env.LOG_LEVEL??'info',redact:['req.headers.authorization','req.headers.cookie','password','token']});
redis.on('error',e=>logger.warn({error:e.message},'Redis connection failure'));
export type Tx=Prisma.TransactionClient;
export async function audit(tx:Tx,userId:string|undefined,action:string,resourceId:string,details:Prisma.InputJsonValue={}){
  await tx.auditLog.create({data:{userId,action,resourceId,details}});
}
export async function lockOrder(tx:Tx,id:string){await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;}
export const catalogVersionKey='catalog:'+new URL(config.DATABASE_URL).pathname+':version';
export async function invalidateCatalog(){await redis.incr(catalogVersionKey).catch(()=>undefined);}
export async function serial<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
  for(let i=0;i<8;i++){
    try{return await db.$transaction(fn,{isolationLevel:'Serializable',maxWait:15000,timeout:20000});}
    catch(e){
      const retryable=e instanceof Prisma.PrismaClientKnownRequestError&&(e.code==='P2034'||(e.code==='P2010'&&['40001','40P01'].includes(String(e.meta?.code))));
      if(retryable&&i<7){await new Promise(resolve=>setTimeout(resolve,Math.min(15*2**i,200)+Math.floor(Math.random()*15)));continue;}
      throw e;
    }
  }
  throw new Error('Transaction retry exhausted');
}
