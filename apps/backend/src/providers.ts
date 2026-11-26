import { createHmac,timingSafeEqual,randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import { S3Client,PutObjectCommand,CreateBucketCommand,PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import { assert } from './http.js';
export function sign(body:Buffer|string,secret:string){return createHmac('sha256',secret).update(body).digest('hex');}
export function verify(body:Buffer,signature:string|undefined,secret:string){const expected=Buffer.from(sign(body,secret));const got=Buffer.from(signature??'');assert(got.length===expected.length&&timingSafeEqual(got,expected),401,'INVALID_SIGNATURE','Invalid webhook signature');}
export const stripe=()=>{const secret=process.env.STRIPE_SECRET_KEY;assert(secret&&secret.startsWith('sk_test_'),503,'SANDBOX_NOT_CONFIGURED','Configure a Stripe test secret');return new Stripe(secret,{timeout:8000,maxNetworkRetries:2});};
export const payments={
  async intent(order:{id:string;total:number;currency:string}){
    if(config.PAYMENT_PROVIDER==='local')return {provider:'local',providerRef:'local_'+order.id,clientSecret:null};
    const p=await stripe().paymentIntents.create({amount:order.total,currency:order.currency.toLowerCase(),metadata:{orderId:order.id},automatic_payment_methods:{enabled:true}},{idempotencyKey:'intent_'+order.id});
    return {provider:'stripe',providerRef:p.id,clientSecret:p.client_secret};
  },
  async refund(paymentRef:string,amount:number,key:string){
    if(config.PAYMENT_PROVIDER==='local')return {providerRef:'local_refund_'+key,status:'SUCCEEDED'};
    const r=await stripe().refunds.create({payment_intent:paymentRef,amount},{idempotencyKey:key});
    return {providerRef:r.id,status:r.status==='succeeded'?'SUCCEEDED':'PENDING'};
  }
};
export const shipping={name:'Local shipping simulator',async create(orderId:string,key:string){return {providerRef:'sim_'+orderId.slice(0,8)+'_'+key.slice(-8)};}};
export async function sendEmail(to:string,subject:string,text:string){
  assert(process.env.EMAIL_PROVIDER!=='external',503,'EMAIL_NOT_CONFIGURED','Use a configured SMTP sandbox');
  // Restrict this educational installation to Mailpit's sandbox listener.
  const host=process.env.SMTP_HOST??'127.0.0.1';assert(['127.0.0.1','localhost','mailpit'].includes(host),503,'EMAIL_SANDBOX_REQUIRED','Only the local email sandbox is enabled');
  return nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT??1025),connectionTimeout:5000,socketTimeout:5000}).sendMail({from:'MarketSphere <sandbox@marketsphere.test>',to,subject,text});
}
export async function uploadImage(buffer:Buffer,mime:string){
  const bucket=process.env.S3_BUCKET??'marketsphere';
  const client=new S3Client({endpoint:process.env.S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID??'',secretAccessKey:process.env.S3_SECRET_ACCESS_KEY??''},requestHandler:{requestTimeout:8000},maxAttempts:3});
  const local=/localhost|127\.0\.0\.1|minio/.test(process.env.S3_ENDPOINT??'');
  if(local){try{await client.send(new CreateBucketCommand({Bucket:bucket}));}catch(e:any){if(!['BucketAlreadyOwnedByYou','BucketAlreadyExists'].includes(e.name))throw e;}
    await client.send(new PutBucketPolicyCommand({Bucket:bucket,Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:'*',Action:['s3:GetObject'],Resource:[`arn:aws:s3:::${bucket}/*`]}]})}));}
  const key=`products/${randomUUID()}.${mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'}`;
  await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:buffer,ContentType:mime,CacheControl:'public, max-age=31536000, immutable'}));
  return `${process.env.S3_PUBLIC_URL??process.env.S3_ENDPOINT}/${bucket}/${key}`;
}
