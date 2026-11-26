import { writeFileSync, mkdirSync } from "node:fs";
import { openapi } from "../apps/backend/src/openapi.js";
import { db, redis } from "../apps/backend/src/repository.js";
mkdirSync("postman", { recursive: true });
const spec = openapi();
writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2));
const items = [];
function sample(schema:any,name=''):any {
  if(!schema)return {};
  if(schema.default!==undefined)return schema.default;
  if(schema.enum)return schema.enum[0];
  if(schema.type==='object')return Object.fromEntries(Object.entries(schema.properties??{}).filter(([k])=>(schema.required??[]).includes(k)).map(([k,v])=>[k,sample(v,k)]));
  if(schema.type==='array')return [sample(schema.items)];
  if(schema.type==='integer'||schema.type==='number')return schema.minimum??100;
  if(schema.type==='boolean')return true;
  if(name==='email')return 'customer@marketsphere.test';
  if(name==='password')return 'MarketSphere!2026';
  if(schema.format==='date-time')return '2030-12-31T00:00:00Z';
  if(name.endsWith('Id'))return '{{'+name+'}}';
  return name==='name'?'Synthetic example':name==='description'?'A synthetic product description for local testing.':'replace-with-'+(name||'value');
}
for (const [path, methods] of Object.entries(spec.paths))
  for (const [method, op] of Object.entries(methods as any)) {
    const o = op as any;
    items.push({
      name: o.summary,
      request: {
        method: method.toUpperCase(),
        header: [
          { key: "Content-Type", value: "application/json" },
          { key: "Idempotency-Key", value: "postman-{{$guid}}" },
        ],
        url: "{{baseUrl}}" + path.replace(/\{(\w+)\}/g, ":$1"),
        ...(method === "get"
          ? {}
          : {
              body: {
                mode: "raw",
                raw: JSON.stringify(sample(o.requestBody?.content?.['application/json']?.schema),null,2),
                options: { raw: { language: "json" } },
              },
            }),
      },
      ...(path.endsWith("/auth/login")
        ? {
            event: [
              {
                listen: "test",
                script: {
                  exec: [
                    "if (pm.response.code === 200) pm.collectionVariables.set('accessToken', pm.response.json().data.accessToken);",
                  ],
                  type: "text/javascript",
                },
              },
            ],
          }
        : {}),
    });
  }
writeFileSync(
  "postman/MarketSphere.postman_collection.json",
  JSON.stringify(
    {
      info: {
        name: "MarketSphere",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      auth: {
        type: "bearer",
        bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
      },
      variable: [
        { key: "baseUrl", value: "http://localhost:4040" },
        { key: "accessToken", value: "" },
      ],
      item: items,
    },
    null,
    2,
  ),
);
await db.$disconnect();
redis.disconnect();
