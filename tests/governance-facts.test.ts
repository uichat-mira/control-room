import assert from "node:assert/strict";
import test from "node:test";
import {
  filterGovernance, governanceSourcePartial, requiresPolicyReview, summarizeGovernance,
} from "../src/governance-facts.ts";
import type { GovernancePayload, GovernanceRepository } from "../src/data.ts";

const row = (name:string, fields:Partial<GovernanceRepository["governance"]>={}) => ({
  name,fullName:"uichat-mira/"+name,htmlUrl:"https://github.com/uichat-mira/"+name,
  defaultBranch:"dev",governance:{
    status:"connected" as const,openIssues:1,openPullRequests:2,
    defaultBranchProtected:true,activeRulesets:0,...fields,
  },
});

test("metric totals preserve known denominators and unknown counts, never turn unread data into zero",()=>{
  assert.equal(summarizeGovernance(null),null);
  const empty=summarizeGovernance([]);
  assert.deepEqual(empty,{repositories:0,issues:null,issuesKnown:0,prs:null,prsKnown:0,protected:0,protectionKnown:0,unprotected:0,protectionUnknown:0,rulesets:null,rulesetsKnown:0,partialReads:0,activeRepos:0});
  const facts=summarizeGovernance([
    row("ok",{openIssues:0,openPullRequests:3,activeRulesets:2}),
    row("open",{defaultBranchProtected:false,openIssues:4,openPullRequests:1,activeRulesets:0}),
    row("partial",{status:"partial",defaultBranchProtected:null,openIssues:null,openPullRequests:null,activeRulesets:null}),
  ]);
  assert.deepEqual(facts,{repositories:3,issues:4,issuesKnown:2,prs:4,prsKnown:2,protected:1,protectionKnown:2,unprotected:1,protectionUnknown:1,rulesets:2,rulesetsKnown:2,partialReads:1,activeRepos:2});
});

test("unprotected default branch requires review, not automatically a policy violation; null stays unknown",()=>{
  assert.equal(requiresPolicyReview(row("open",{defaultBranchProtected:false})),true);
  assert.equal(requiresPolicyReview(row("protected")),false);
  assert.equal(requiresPolicyReview(row("unknown",{defaultBranchProtected:null})),false);
});

test("search and all, activity, review, unknown filters keep exact repository records",()=>{
  const rows=[
    row("foo",{openPullRequests:4}),
    row("bar",{defaultBranchProtected:false,openIssues:0,openPullRequests:0}),
    row("other",{status:"partial",defaultBranchProtected:null,activeRulesets:null,openIssues:null,openPullRequests:null}),
  ];
  assert.deepEqual(filterGovernance(rows,"","all").map(x=>x.name),["foo","bar","other"]);
  assert.deepEqual(filterGovernance(rows,"","activity").map(x=>x.name),["foo"]);
  assert.deepEqual(filterGovernance(rows,"","review").map(x=>x.name),["bar"]);
  assert.deepEqual(filterGovernance(rows,"","unknown").map(x=>x.name),["other"]);
  assert.deepEqual(filterGovernance(rows," BAR ","all").map(x=>x.name),["bar"]);
  assert.deepEqual(filterGovernance(rows,"MAIN","all"),[]);
  assert.equal(rows[0].name,"foo","no source mutation");
});

test("read-model health reflects refresh errors, partial governance and unavailable Projects",()=>{
  const data={status:"connected",github:{governanceStatus:"connected",projects:{status:"connected"}},repositories:[row("ok")]} as GovernancePayload;
  assert.equal(governanceSourcePartial(data,null),false);
  assert.equal(governanceSourcePartial(data,"HTTP 503"),true);
  assert.equal(governanceSourcePartial(null,null),true);
  assert.equal(governanceSourcePartial({...data,status:"degraded"},null),true);
  assert.equal(governanceSourcePartial({...data,github:{...data.github,projects:{status:"unavailable",items:[]}}},null),true);
  assert.equal(governanceSourcePartial({...data,repositories:[row("partial",{status:"partial"})]},null),true);
});
