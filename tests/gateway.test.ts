import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Gateway is intentionally standalone JS for Pages advanced mode.
import gateway from '../pages/gateway/_worker.js';
test('Pages gateway rejects preview/alternate hosts and forwards request unchanged through private binding',async()=>{
  let received:Request|undefined;
  const env={ALLOWED_ORIGIN:'https://public.example',APP:{fetch:async(req:Request)=>{received=req;return new Response('ok');}}};
  for(const host of ['https://project.pages.dev','https://preview.project.pages.dev'])assert.equal((await gateway.fetch(new Request(host),env)).status,403);
  assert.equal(received,undefined);
  const req=new Request(env.ALLOWED_ORIGIN+'/api/auth/callback?code=test',{headers:{'CF-Connecting-IP':'192.0.2.1',Cookie:'session=test'}});
  assert.equal((await gateway.fetch(req,env)).status,200);assert.equal(received,req);
  assert.equal((await gateway.fetch(req,{ALLOWED_ORIGIN:env.ALLOWED_ORIGIN})).status,503);
});
