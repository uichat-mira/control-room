import assert from "node:assert/strict";
import test from "node:test";
import { analyticsCoverage, orderServices, summarizeProbes, workerTrafficRows } from "../src/runtime-facts.ts";
import type { ServiceProbe } from "../src/shared.ts";
import type { CloudflareWorkerAnalytics } from "../src/cloudflare-analytics.ts";

const probe=(id:string,status:ServiceProbe["status"],latencyMs:number|null):ServiceProbe=>({
  id,label:id,url:"https://example.com/"+id,status,
  httpStatus:status==="offline"?null:200,latencyMs,detail:status,
});
const worker=(name:string,requests:number,errors:number,truncated=false):CloudflareWorkerAnalytics=>({
  name,requests,errors,errorRate:requests?errors/requests*100:0,subrequests:0,truncated,
});

test("probe health is unknown before a snapshot, rather than healthy or zero",()=>{
  assert.equal(summarizeProbes(null),null);
  assert.deepEqual(summarizeProbes([]),{total:0,online:0,degraded:0,offline:0});
});

test("service priority preserves all records while putting real outages and degraded probes first",()=>{
  const rows=[probe("ok","online",42),probe("warn","degraded",190),probe("down","offline",null),probe("ok2","online",20)];
  assert.deepEqual(orderServices(rows).map(x=>x.id),["down","warn","ok","ok2"]);
  assert.equal(rows[0].id,"ok","source array not mutated");
  assert.deepEqual(summarizeProbes(rows),{total:4,online:2,degraded:1,offline:1});
});

test("worker chart only includes positive request observations and sorts by measured traffic",()=>{
  const rows=[worker("uichat-mira-low",8,1),worker("uichat-mira-zero",0,0),worker("uichat-mira-high",20,0)];
  assert.deepEqual(workerTrafficRows(rows).map(x=>x.name),["high","low"]);
  assert.deepEqual(workerTrafficRows(rows).map(x=>x.errors),[0,1]);
  assert.equal(rows[0].name,"uichat-mira-low","source array not mutated");
});

test("truncated analytics remain explicitly incomplete, unknown data are not treated as complete zero",()=>{
  assert.equal(analyticsCoverage(null),"unknown");
  assert.equal(analyticsCoverage([]),"observed");
  assert.equal(analyticsCoverage([worker("one",50,2)]),"observed");
  assert.equal(analyticsCoverage([worker("one",50,2,true)]),"truncated");
});
