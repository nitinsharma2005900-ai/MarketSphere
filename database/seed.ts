import bcrypt from 'bcryptjs';
import {db,redis} from '../apps/backend/src/repository.js';
import {checkout,paymentIntent,paymentEvent,fulfill,shippingEvent,requestReturn,receiveReturn,refundReturn,settle} from '../apps/backend/src/commerce.js';
import type {Actor} from '../apps/backend/src/http.js';
const password=process.env.DEMO_PASSWORD;if(!password||password.length<12)throw new Error('Set DEMO_PASSWORD for the local seed');
if(process.env.NODE_ENV==='production')throw new Error('Synthetic demo seed is disabled in production');
const passwordHash=await bcrypt.hash(password,12);
const people=[['customer','Alex Morgan','CUSTOMER'],['customer2','Jamie Park','CUSTOMER'],['seller','The Everyday Studio','SELLER'],['seller2','Form & Field','SELLER'],['seller3','Northline Supply','SELLER'],['seller4','Kindred Living','SELLER'],['seller5','Atlas Collective','SELLER'],['warehouse','Sam Rivera','WAREHOUSE'],['support','Taylor Brooks','SUPPORT'],['admin','Jordan Ellis','ADMIN']] as const;
const users=[];
for(const [handle,name,role] of people){const user=await db.user.upsert({where:{email:handle+'@marketsphere.test'},create:{email:handle+'@marketsphere.test',name,role,passwordHash,cart:role==='CUSTOMER'?{create:{}}:undefined,seller:role==='SELLER'?{create:{name,status:'APPROVED'}}:undefined},update:{},include:{seller:true}});users.push(user);if(role==='CUSTOMER'&&!await db.address.findFirst({where:{userId:user.id}}))await db.address.create({data:{userId:user.id,name,line1:'42 Demo Avenue',city:'Bengaluru',region:'Karnataka',postalCode:'560001',country:'IN'}});}
const sellers=users.filter(u=>u.seller).map(u=>u.seller!);
const categories=[];for(const [name,slug] of [['Electronics','electronics'],['Bags & Travel','bags-travel'],['Home & Living','home-living'],['Footwear','footwear'],['Clothing','clothing'],['Accessories','accessories']])categories.push(await db.category.upsert({where:{slug},create:{name,slug},update:{}}));
const warehouses=[];for(const [name,city] of [['South Fulfillment Centre','Bengaluru'],['West Fulfillment Centre','Mumbai']])warehouses.push(await db.warehouse.upsert({where:{name},create:{name,city},update:{}}));
const names=['Studio wireless headphones','Everyday carry backpack','Handcrafted ceramic mug','Arc lounge chair','Forma table lamp','Weekend everyday sneaker','Utility overshirt','Terra ceramic planter','Pulse everyday watch','Frame compact camera'];
const cat=[0,1,2,2,2,3,4,2,5,0];const prices=[899900,349900,129900,1299900,429900,499900,329900,159900,699900,2499900];
const adjectives=['','Essential ','Signature ','Classic ','Limited '];
const products=[];
for(let n=0;n<50;n++){
  const name=adjectives[Math.floor(n/10)]+names[n%10];const product=await db.product.upsert({where:{slug:'product-'+(n+1)},create:{name,slug:'product-'+(n+1),description:`Thoughtfully designed for your everyday. The ${name.toLowerCase()} combines considered materials, lasting quality and a clean, timeless finish. Made by an independent seller, selected by MarketSphere. This is a synthetic demonstration product with an original vector illustration.`,image:'/products/product-'+(n+1)+'.svg',categoryId:categories[cat[n%10]].id,sellerId:sellers[n%5].id,status:'ACTIVE',featured:n<10,variants:{create:[{sku:`MS-${String(n+1).padStart(3,'0')}-STD`,name:'Standard',price:prices[n%10]+Math.floor(n/10)*20000,attributes:{finish:'Original'}},{sku:`MS-${String(n+1).padStart(3,'0')}-PRE`,name:'Premium',price:prices[n%10]+50000+Math.floor(n/10)*20000,attributes:{finish:'Premium'}}]}},update:{},include:{variants:true}});products.push(product);
  for(const v of product.variants)for(let w=0;w<2;w++){const inv=await db.inventory.upsert({where:{variantId_warehouseId:{variantId:v.id,warehouseId:warehouses[w].id}},create:{variantId:v.id,warehouseId:warehouses[w].id,onHand:0},update:{}});if(!await db.stockMovement.findUnique({where:{key:'seed:'+inv.id}}))await db.$transaction([db.inventory.update({where:{id:inv.id},data:{onHand:{increment:w===0?25:12}}}),db.stockMovement.create({data:{inventoryId:inv.id,key:'seed:'+inv.id,kind:'OPENING',deltaOnHand:w===0?25:12,deltaReserved:0,reason:'Synthetic opening inventory'}})]);}
}
await db.promotion.upsert({where:{code:'WELCOME10'},create:{code:'WELCOME10',discountBps:1000,minSubtotal:100000,maxDiscount:100000,endsAt:new Date('2030-12-31')},update:{}});
const admin:Actor={id:users[9].id,role:'ADMIN'};
for(let n=0;n<12;n++){
  const customer=users[n%2];const actor:Actor={id:customer.id,role:'CUSTOMER'};
  if(await db.order.findUnique({where:{userId_checkoutKey:{userId:actor.id,checkoutKey:'seed-order-'+n}}}))continue;
  const cart=await db.cart.findUniqueOrThrow({where:{userId:customer.id}});await db.cartItem.deleteMany({where:{cartId:cart.id}});
  const prod=products[n%10];await db.cartItem.create({data:{cartId:cart.id,variantId:prod.variants[0].id,quantity:2}});
  const address=await db.address.findFirstOrThrow({where:{userId:customer.id}});
  const order=await checkout(actor,address.id,undefined,'seed-order-'+n);const intent=await paymentIntent(order.id);await paymentEvent({id:'seed-payment-'+n,providerRef:intent.providerRef,type:'SUCCEEDED',amount:order.total});
  await db.order.update({where:{id:order.id},data:{createdAt:new Date(Date.now()-(12-n)*86400000)}});
  if(n<10){const allocations=await db.reservation.findMany({where:{orderId:order.id},include:{inventory:true}});for(const a of allocations){const ship=await fulfill(admin,order.id,a.inventory.warehouseId,[{orderItemId:order.items[0].id,quantity:a.quantity}],'seed-ship-'+n+'-'+a.id);await shippingEvent({id:'seed-delivery-'+ship.id,providerRef:ship.providerRef,status:'DELIVERED'});}
    await db.review.upsert({where:{userId_productId:{userId:customer.id,productId:prod.id}},create:{userId:customer.id,productId:prod.id,rating:n%3===0?4:5,comment:'Beautifully considered design and excellent quality. A lovely addition to my everyday.'},update:{}});
    if(n===0){const r=await requestReturn(actor,order.id,'Synthetic return: one item was not the right fit',[{orderItemId:order.items[0].id,quantity:1}]);await receiveReturn(admin,r.id,true);await refundReturn(admin,r.id);}
    if(n===1)await requestReturn(actor,order.id,'Synthetic return awaiting inspection',[{orderItemId:order.items[0].id,quantity:1}]);
  }
}
for(const seller of sellers){try{await settle(admin,seller.id,'seed-settlement-'+seller.id);}catch(e:any){if(e.code!=='NOTHING_TO_SETTLE')throw e;}}
if(!await db.ticket.findFirst()){const order=await db.order.findFirstOrThrow({where:{userId:users[0].id}});await db.ticket.create({data:{userId:users[0].id,orderId:order.id,subject:'Help with a delivery update',message:'Could you confirm the estimated arrival for my demonstration order?',assigneeId:users[8].id,messages:{create:{authorId:users[8].id,text:'We are reviewing your shipment with the local shipping simulator.'}}}});await db.ticket.create({data:{userId:users[1].id,subject:'Return inspection question',message:'I would like an update on the inspection of my returned item.',dispute:{create:{status:'OPEN'}}}});}
for(const customer of users.slice(0,2))if(!await db.browseEvent.findFirst({where:{userId:customer.id,type:'VIEW'}}))await db.browseEvent.createMany({data:products.slice(0,12).map(p=>({userId:customer.id,productId:p.id,type:'VIEW'}))});
console.log('Seeded 50 products, 100 SKUs, 5 sellers, 2 warehouses, 10 role accounts and complete synthetic commerce history.');
await db.$disconnect();redis.disconnect();
