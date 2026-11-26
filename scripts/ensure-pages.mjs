import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../pages/wrangler.jsonc',import.meta.url),'utf8'));
const cli=new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url);
const run=(args,stdio='pipe')=>execFileSync(process.execPath,[cli.pathname,...args],{encoding:'utf8',stdio,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const projects=JSON.parse(run(['pages','project','list','--json']));
if(!projects.some(p=>p['Project Name']===config.name))run(['pages','project','create',config.name,'--production-branch','main'],'inherit');
else console.log('Pages project exists: '+config.name);
