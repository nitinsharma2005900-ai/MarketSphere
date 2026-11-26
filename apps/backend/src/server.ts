import {app} from './app.js';
import {config} from './config.js';
import {db,redis,logger} from './repository.js';
const server=app.listen(config.PORT,'0.0.0.0',()=>logger.info({port:config.PORT},'MarketSphere API listening'));
async function stop(){server.close(async()=>{await redis.quit();await db.$disconnect();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
