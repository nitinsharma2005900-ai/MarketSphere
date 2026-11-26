import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash,randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { db,serial,audit,type Tx } from './repository.js';
import { config } from './config.js';
import { assert,authenticate,ApiError } from './http.js';
import type { Response } from 'express';
export const auth=Router();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const cookie=(res:Response,token:string)=>res.cookie('ms_refresh',token,{httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production',path:'/api/v1/auth',maxAge:7*86400000});
const publicUser=(u:{id:string;name:string;email:string;role:string})=>({id:u.id,name:u.name,email:u.email,role:u.role});
async function tokens(user:{id:string;name:string;email:string;role:string},family:string=randomUUID(),tx:Tx=db){
  const accessToken=jwt.sign({},config.JWT_ACCESS_SECRET,{subject:user.id,issuer:'marketsphere',audience:'marketsphere-web',expiresIn:'15m',algorithm:'HS256'});
  const refresh=jwt.sign({family},config.JWT_REFRESH_SECRET,{subject:user.id,jwtid:randomUUID(),expiresIn:'7d',algorithm:'HS256'});
  await tx.refreshToken.create({data:{userId:user.id,tokenHash:hash(refresh),family,expiresAt:new Date(Date.now()+7*86400000)}});
  return {refresh,data:{user:publicUser(user),accessToken}};
}
auth.use(rateLimit({windowMs:15*60000,limit:100,standardHeaders:'draft-8',legacyHeaders:false}));
export const registerSchema=z.object({name:z.string().trim().min(2).max(100),email:z.email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(12).max(128),role:z.enum(['CUSTOMER','SELLER']).default('CUSTOMER'),storeName:z.string().trim().min(2).max(100).optional()});
auth.post('/register',async(req,res)=>{
  const input=registerSchema.parse(req.body);
  const user=await db.user.create({data:{name:input.name,email:input.email,passwordHash:await bcrypt.hash(input.password,12),role:input.role,cart:{create:{}},...(input.role==='SELLER'?{seller:{create:{name:input.storeName??input.name+" Studio"}}}:{})}});
  const t=await tokens(user);cookie(res,t.refresh);res.status(201).json({data:t.data});
});
auth.post('/login',async(req,res)=>{
  const input=z.object({email:z.email().transform(s=>s.toLowerCase()),password:z.string().max(128)}).parse(req.body);
  const user=await db.user.findUnique({where:{email:input.email}});
  const ok=await bcrypt.compare(input.password,user?.passwordHash??'$2b$12$C6UzMDM.H6dfI/f/IKcEe.3A/5cauFa8hIu9pa9Nuw7o50BPe.QKi');
  assert(user?.active&&ok,401,'INVALID_CREDENTIALS','Email or password is incorrect');
  const t=await tokens(user);cookie(res,t.refresh);res.json({data:t.data});
});
auth.post('/refresh',async(req,res)=>{
  assert(req.headers.origin===config.FRONTEND_URL,403,'ORIGIN_REJECTED','Refresh requires the trusted storefront origin');
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('ms_refresh='))?.slice(11);
  assert(token,401,'INVALID_REFRESH','No refresh session');
  let payload:jwt.JwtPayload;try{payload=jwt.verify(token,config.JWT_REFRESH_SECRET,{algorithms:['HS256']}) as jwt.JwtPayload;}catch{throw new ApiError(401,'INVALID_REFRESH','Invalid refresh token');}
  const result=await serial(async tx=>{
    const saved=await tx.refreshToken.findUnique({where:{tokenHash:hash(token)}});
    if(!saved||saved.revokedAt||saved.expiresAt<new Date()){
      await tx.refreshToken.updateMany({where:{family:payload.family},data:{revokedAt:new Date()}});return null;
    }
    const user=await tx.user.findUnique({where:{id:saved.userId}});
    if(!user?.active)return null;
    await tx.refreshToken.update({where:{id:saved.id},data:{revokedAt:new Date()}});
    await audit(tx,user.id,'SESSION_ROTATED',saved.id);return tokens(user,saved.family,tx);
  });
  assert(result,401,'REFRESH_REUSED','Session expired or reused; sign in again');
  cookie(res,result.refresh);res.json({data:result.data});
});
auth.post('/logout',authenticate,async(req,res)=>{await db.refreshToken.updateMany({where:{userId:req.actor!.id},data:{revokedAt:new Date()}});res.clearCookie('ms_refresh',{path:'/api/v1/auth'});res.json({data:{signedOut:true}});});
auth.get('/me',authenticate,async(req,res)=>{const u=await db.user.findUniqueOrThrow({where:{id:req.actor!.id},include:{seller:true}});res.json({data:{...publicUser(u),seller:u.seller}});});
