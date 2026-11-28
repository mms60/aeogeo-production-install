'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../site/assets/geo.js'),'utf8'),start=source.indexOf('/* account-usage:start */'),end=source.indexOf('/* account-usage:end */');
assert.ok(start>=0&&end>start,'account usage markers are missing from geo.js');
const accountUsage=vm.runInNewContext(source.slice(start,end)+';accountUsage',{});

test('free account reports no paid usage period and no scan allowance',()=>{
 const usage=accountUsage(null,null,false);
 assert.equal(usage.text,'No active paid usage period');
 assert.deepEqual({used:usage.used,reserved:usage.reserved,limit:usage.limit},{used:0,reserved:0,limit:25});
});

test('paid account with a usage period shows page and scan usage',()=>{
 const usage=accountUsage({used_pages:12,reserved_pages:3,scans_used:1,scans_reserved:2},{monthlyPages:1500,scansPerMonth:6},true);
 assert.equal(usage.text,'12 analyzed + 3 reserved / 1500 this period; monitoring scans 1 used, 2 reserved of 6');
 assert.deepEqual({used:usage.used,reserved:usage.reserved,limit:usage.limit},{used:12,reserved:3,limit:1500});
});

test('paid account without a usage period still shows the scan allowance',()=>{
 const usage=accountUsage(null,{monthlyPages:5000,scansPerMonth:20},true);
 assert.equal(usage.text,'0 analyzed + 0 reserved / 5000 this period; monitoring scans 0 used, 0 reserved of 20');
 assert.equal(usage.limit,5000);
});
