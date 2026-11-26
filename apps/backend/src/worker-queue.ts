import { Queue } from 'bullmq';
import { redis } from './repository.js';
export const commerceQueue=new Queue('marketsphere-commerce',{connection:redis as any,defaultJobOptions:{attempts:5,backoff:{type:'exponential',delay:2000},removeOnComplete:{count:1000},removeOnFail:{count:500}}});
