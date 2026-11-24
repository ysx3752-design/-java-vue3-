const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const now=Date.parse('2026-11-15T10:37:00Z')
async function api(rows=[], failCount=false){
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const ctx=vm.createContext({Date:Clock,console})
 const modules={
  '@/utils/request':{default:async config=>{if(config.url==='/api/alerts/count'){if(failCount)throw Error('offline');return {count:19}}
    if(config.url==='/api/alerts/recent')return Array.from({length:5},()=>({status:'未处理'}))
    return rows}},
  './sensor':{getSensorData:async()=>({air_temperature:20})},
  './device':{getDeviceStatus:async()=>({devices:[]}),getConnectionStatus:async()=>({status:'connected'})}
 }
 const mod=new vm.SourceTextModule(readFileSync(resolve(__dirname,'../src/api/dashboard.js'),'utf8'),{context:ctx})
 await mod.link(name=>new vm.SyntheticModule(Object.keys(modules[name]),function(){for(const [k,v]of Object.entries(modules[name]))this.setExport(k,v)},{context:ctx}))
 await mod.evaluate();return mod.namespace
}
test('dashboard total is independent of five recent alerts',async()=>{
 const result=await(await api()).getDashboardData();assert.equal(result.alerts.length,5);assert.equal(result.alertCount,19)
})
test('a failed count endpoint does not discard other dashboard data',async()=>{
 const result=await(await api([],true)).getDashboardData();assert.equal(result.alertCount,null);assert.equal(result.alerts.length,5);assert.equal(result.sensorData.air_temperature,20)
})
test('sparse records keep their own hour bin and mock fill covers the rest',async()=>{
 const result=await(await api([{timestamp:new Date(now-60000).toISOString(),air_temperature:0,air_humidity:0}])).getTempHumidityTrend()
 // 24 个整点小时槽：真实值保留在自己的槽里，其余小时由演示假数据按昼夜曲线补齐
 assert.equal(result.times.length,24);assert.ok(result.times.every(t=>t.endsWith(':00')))
 assert.equal(result.temperatures[23],0);assert.equal(result.humidities[23],0)
 assert.ok(result.temperatures.slice(0,23).every(v=>v!==null&&Number.isFinite(v)))
 assert.ok(result.humidities.slice(0,23).every(v=>v!==null&&Number.isFinite(v)))
})
test('hourly bins average valid readings, gaps are mock-filled and real anchors are bridged',async()=>{
 const result=await(await api([
 {timestamp:new Date(now-55*60000).toISOString(),air_temperature:20,air_humidity:null},
 {timestamp:new Date(now-50*60000).toISOString(),air_temperature:24},
 {timestamp:'invalid',air_temperature:100},
 {timestamp:new Date(now-30*3600000).toISOString(),air_temperature:100}
 ])).getTempHumidityTrend()
 // 真实均值仍只算有效读数（invalid 与 30 小时前的记录不参与）
 assert.equal(result.temperatures[22],22)
 // 空档全部补齐，且与真实锚点平滑衔接：紧邻真实值的槽不会跳变
 assert.ok(result.temperatures[23]!==null);assert.ok(Math.abs(result.temperatures[23]-22)<5)
 assert.ok(result.temperatures.slice(0,22).every(v=>v!==null&&Number.isFinite(v)))
 assert.ok(result.humidities.every(v=>v!==null&&Number.isFinite(v)&&v>=25&&v<=75))
})
