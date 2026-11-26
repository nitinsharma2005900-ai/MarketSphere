const urls=['http://localhost:4040/ready','http://localhost:3040'];
for(const url of urls){let ready=false;for(let attempt=0;attempt<40;attempt++){try{ready=(await fetch(url,{signal:AbortSignal.timeout(3000)})).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,1000));}if(!ready)throw new Error('Service not ready: '+url);}
console.log('Frontend and API are ready.');
