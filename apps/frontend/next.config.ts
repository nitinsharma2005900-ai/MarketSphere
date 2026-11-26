import type { NextConfig } from 'next';
import {config as load} from 'dotenv';
import path from 'node:path';
load({path:path.resolve(process.cwd(),'../../.env'),quiet:true});
const config:NextConfig={output:'standalone',poweredByHeader:false};
export default config;
