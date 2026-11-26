import { config } from './config.js';
import { ApiError } from './http.js';
export async function python<T=any>(path:string,body:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch(config.PYTHON_SERVICE_URL+path,{method:'POST',headers:{'Content-Type':'application/json','X-Service-Token':config.INTERNAL_SERVICE_TOKEN},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)});}catch{throw new ApiError(503,'PROCESSING_UNAVAILABLE','The processing service is temporarily unavailable');}
  if(!response.ok)throw new ApiError(response.status===422?422:503,'PROCESSING_ERROR','The processing service rejected this request');
  return response.json() as Promise<T>;
}
