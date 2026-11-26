import {defineConfig} from 'vitest/config';
import {config} from 'dotenv';
config({path:'.env',quiet:true});config({path:'.env.test',override:true,quiet:true});
export default defineConfig({test:{include:['tests/**/*.test.{ts,tsx}'],exclude:['tests/e2e/**'],fileParallelism:false,testTimeout:30000,hookTimeout:30000,reporters:['default','json','junit'],outputFile:{json:'docs/evidence/vitest-results.json',junit:'docs/evidence/vitest-results.xml'},coverage:{provider:'v8',include:['apps/backend/src/{auth,http,commerce,routes,python,providers}.ts','apps/frontend/components/ui.tsx'],reporter:['text','json-summary','html'],reportsDirectory:'docs/evidence/coverage'}}});
