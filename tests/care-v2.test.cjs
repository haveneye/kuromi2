const test=require('node:test');
const assert=require('node:assert/strict');
const Care=require('../game-state.js');
const R=Care.Rules;
class Storage {
  constructor(){this.data=new Map();this.fail=false;}
  get length(){return this.data.size;}
  key(i){return [...this.data.keys()][i]??null;}
  getItem(k){return this.data.get(k)??null;}
  setItem(k,v){if(this.fail)throw new Error('Quota');this.data.set(k,String(v));}
  removeItem(k){this.data.delete(k);}
}
const at=(day=1,h=7,m=0)=>new Date(`2026-11-${String(day).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`);
async function env(base=null,random=()=>0) {
  const storage=new Storage();let now=at();let queue=Promise.resolve();
  const options={now:()=>now,random,withLock:task=>{const r=queue.then(task);queue=r.catch(()=>{});return r;}};
  if(base) {
    const old=Care.repository(storage,{...options,rulesVersion:1});
    await old.saveProfile({name:'연탄',gender:'female'});
    const saved=JSON.parse(storage.getItem(Care.PROFILE_KEY));saved.base=base;
    storage.setItem(Care.PROFILE_KEY,JSON.stringify(saved));
  }
  const repo=Care.repository(storage,options);
  if(!base)await repo.saveProfile({name:'연탄',gender:'female'});
  else repo.snapshot();
  return {storage,repo,options,time:d=>{now=d;},now:()=>now};
}
const doc=(fullness=70)=>({version:2,startedAt:+at(1,0),base:{affection:80,fullness},excluded:[],actions:[]});

test('v2: 신규 입양은 10/70, 개인기 0개·숙련도 0이며 기존 기록은 값 그대로 이관',async()=>{
  const e=await env();const s=e.repo.snapshot();
  assert.deepEqual(s.stats,{affection:10,fullness:70});assert.equal(s.newlyAdopted,true);
  assert.deepEqual(s.training.learned,[]);assert.equal(s.training.mastery.sit,0);
  const old=await env({affection:65,fullness:80});
  const profile=old.storage.getItem(Care.PROFILE_KEY);
  assert.deepEqual(old.repo.snapshot().stats,{affection:65,fullness:80});
  assert.equal(old.storage.getItem(Care.PROFILE_KEY),profile);
  assert.equal(JSON.parse(old.storage.getItem(R.KEY)).migratedFrom,1);
});
test('v2: 식사 +1/+30, 중복·종료시간 거절, 누락 -6/-15는 한 번',async()=>{
  const e=await env();
  const fed=await e.repo.feed();assert.equal(fed.ok,true);
  assert.deepEqual(fed.state.stats,{affection:11,fullness:100});
  assert.equal((await e.repo.feed()).reason,'already-eaten');
  const missed=await env();missed.time(at(1,10));
  const state=missed.repo.snapshot();assert.deepEqual(state.stats,{affection:4,fullness:49});
  assert.equal(state.meals[0].status,'missed');
  assert.equal((await missed.repo.feed()).reason,'outside-window');
  assert.deepEqual(missed.repo.snapshot().stats,state.stats);
});
test('v2: 오프라인 2시간 -4, 재실행·반복 조회 중복 감소 없음, 계산 시각 저장',async()=>{
  const e=await env();e.time(at(1,8));
  assert.equal(e.repo.snapshot().stats.fullness,68);
  e.time(at(1,8,59));assert.equal(e.repo.snapshot().stats.fullness,68);
  const reopened=Care.repository(e.storage,e.options);
  e.time(at(1,9));assert.equal(reopened.snapshot().stats.fullness,66);
  assert.deepEqual(reopened.snapshot().stats,e.repo.snapshot().stats);
  assert.equal(JSON.parse(e.storage.getItem(R.CHECKPOINT_KEY)).lastCalculatedAt,at(1,9).toISOString());
});
test('v2: 포만감 70 미만 3시간 -2, 20 이하 -3, 구간 변경 시 타이머 재시작',()=>{
  assert.equal(R.calculate(doc(69),[],at(1,2,59)).stats.affection,80);
  assert.equal(R.calculate(doc(69),[],at(1,3)).stats.affection,78);
  // 21 -> 19 at hour 1: low-band timer restarts, no penalty at hour 3.
  assert.equal(R.calculate(doc(21),[],at(1,3)).stats.affection,80);
  assert.equal(R.calculate(doc(21),[],at(1,4)).stats.affection,77);
  assert.equal(R.calculate(doc(20),[],at(1,3)).stats.affection,77);
  const facts=[{id:'snack',type:'snack',at:+at(1,2,30)}];
  // 69 -> 65 -> 70 at 02:30, then 68 at 03:00: a fresh 3-hour period.
  assert.equal(R.calculate(doc(69),facts,at(1,5,59)).stats.affection,84);
  assert.equal(R.calculate(doc(69),facts,at(1,6)).stats.affection,82);
});
test('v2: 매일 기본 -3 및 온전한 날 산책 미실시 -2, 중복 적용 없음',()=>{
  const d=doc(100);
  // Supply meals so hunger cannot interfere with the daily deductions.
  const facts=[];
  for(let day=1;day<=2;day++)for(const h of [7,13,18])facts.push({id:`${day}-${h}`,type:'completed',at:+at(day,h)});
  const before=R.calculate(d,facts,at(2,23,59));
  const after=R.calculate(d,facts,at(3,0));
  assert.equal(after.stats.affection,before.stats.affection-5);
  d.actions=[{id:'walk',type:'walk',at:+at(2,10)}];
  const a=R.calculate(d,facts,at(2,23,59)),b=R.calculate(d,facts,at(3,0));
  assert.equal(b.stats.affection,a.stats.affection-3);
});
test('v2: 간식 실제 급여만 반영, 합산 3개·한국 자정 초기화',async()=>{
  const e=await env();const before=e.repo.snapshot().stats;
  for(let i=0;i<3;i++)assert.equal((await e.repo.buySnack('milk','buy'+i)).ok,true);
  assert.deepEqual(e.repo.snapshot().stats,before);
  for(let i=0;i<3;i++){const r=await e.repo.giveSnack('milk','give'+i);assert.equal(r.ok,true);}
  assert.deepEqual(e.repo.snapshot().stats,{affection:16,fullness:85});
  assert.equal((await e.repo.giveSnack('milk','fourth')).reason,'daily-limit');
  e.time(at(2,0));assert.equal(e.repo.snapshot().snacks.usedToday,0);
});
test('v2: 훈련 순서·친밀도 잠금, 성공/실패 비용과 숙련도, 전체 일일 3회',async()=>{
  const low=await env();assert.equal((await low.repo.train('sit','locked')).reason,'bond-required');
  const e=await env({affection:80,fullness:80});
  assert.equal((await e.repo.train('paw','skip')).reason,'sequence');
  const success=await e.repo.train('sit','one');
  assert.equal(success.event.gain,10);assert.deepEqual(success.state.stats,{affection:81,fullness:77});
  assert.equal(success.state.training.mastery.sit,10);
  const failRepo=Care.repository(e.storage,{...e.options,random:()=>.99});
  const failed=await failRepo.train('sit','two');
  assert.equal(failed.event.success,false);assert.equal(failed.event.gain,0);
  assert.deepEqual(failed.state.stats,{affection:81,fullness:74});
  assert.equal(failed.state.training.mastery.sit,10);
  await e.repo.train('sit','three');
  assert.equal((await e.repo.train('sit','four')).reason,'daily-limit');
  assert.equal(e.repo.snapshot().training.usedToday,3);
  e.time(at(2,7));assert.equal(e.repo.snapshot().training.usedToday,0);
  assert.equal(e.repo.snapshot().training.mastery.sit,20);
});
test('v2: 마지막 습득과 다음 기술도 하루 횟수 공유, 습득은 친밀도 하락 후 유지',async()=>{
  const e=await env({affection:100,fullness:100},()=>.1);
  // Fixture: prior days of completed training, just before mastering sit.
  const actions=[];
  for(let i=0;i<4;i++)actions.push({id:'history'+i,type:'train',trickId:'sit',success:true,gain:20,at:+at(i<3?1:2,7)});
  e.storage.setItem(R.ACTION_KEY,JSON.stringify({version:2,actions}));
  // Move to next day: the fixture's old attempts do not use today's quota.
  e.time(at(2,7));await e.repo.feed();
  const r=await Care.repository(e.storage,{...e.options,random:(()=>{let call=0;return()=>call++%2===0?0:.999;})()}).train('sit','finish');
  assert.equal(r.ok,true);assert.equal(r.state.training.mastery.sit,100);
  assert.equal(r.state.training.current.id,'paw');
  await e.repo.train('paw','paw1');await e.repo.train('paw','paw2');
  assert.equal((await e.repo.train('paw','paw3')).reason,'daily-limit');
  e.time(at(6,7));const state=e.repo.snapshot();
  assert(state.training.learned.includes('sit'));assert.equal(state.training.mastery.sit,100);
  assert.equal(state.stats.affection,0);
});
test('v2: 동시 훈련 20건도 3회, 동일 요청 중복 보상 거절 및 저장 실패 보존',async()=>{
  const e=await env({affection:80,fullness:80});
  const tabs=[e.repo,Care.repository(e.storage,e.options)];
  const results=await Promise.all(Array.from({length:20},(_,i)=>tabs[i%2].train('sit','req'+i)));
  assert.equal(results.filter(r=>r.ok).length,3);
  assert.equal((await e.repo.train('sit','req0')).reason,'duplicate-request');
  assert.equal(e.repo.snapshot().training.mastery.sit,30);
  const f=await env({affection:80,fullness:80});f.storage.fail=true;
  await assert.rejects(f.repo.train('sit','failure'),/Quota/);
  f.storage.fail=false;assert.equal(f.repo.snapshot().training.usedToday,0);
});
test('v2: 산책 완료 +3/-10 하루 1회, 놀이 +1/-5, 기록 재실행 복원',async()=>{
  const e=await env();const walk=await e.repo.completeWalk('walk');
  assert.deepEqual(walk.state.stats,{affection:13,fullness:60});
  assert.equal((await e.repo.completeWalk('walk-again')).reason,'already-walked');
  await e.repo.buyToy('tennis','toy-buy');const play=await e.repo.playToy('tennis','toy-play');
  assert.deepEqual(play.state.stats,{affection:14,fullness:57});
  assert.equal(Care.repository(e.storage,e.options).snapshot().walkedToday,true);
});
test('v2: 기기 시간대 UTC여도 식사·간식·훈련 날짜는 한국 시간',async()=>{
  const previous=process.env.TZ;process.env.TZ='UTC';
  try{
    const e=await env({affection:80,fullness:80});
    assert.equal(Care.currentMeal(e.now()).id,'breakfast');
    assert.equal((await e.repo.feed()).ok,true);
    await e.repo.train('sit','kst');
    e.time(new Date('2026-11-01T15:00:00Z'));
    assert.equal(e.repo.snapshot().date,'2026-11-02');
    assert.equal(e.repo.snapshot().training.usedToday,0);
    assert.equal(e.repo.snapshot().training.mastery.sit,10);
  }finally{process.env.TZ=previous||'Asia/Seoul';}
});
test('v2: 과거 다른 시간대로 저장된 간식도 한국 날짜에 합산하고 원본은 유지',async()=>{
  const e=await env();
  const originalDate=e.now().toISOString().slice(0,10);
  const transactions=['buy','give'].map(type=>({id:'utc-'+type,type,snackId:'milk',date:originalDate,at:e.now().toISOString(),offset:0}));
  e.storage.setItem(Care.SNACK_KEY,JSON.stringify({schemaVersion:1,transactions}));
  assert.equal(e.repo.snapshot().snacks.usedToday,1);
  for(let i=0;i<2;i++){await e.repo.buySnack('milk','kstbuy'+i);await e.repo.giveSnack('milk','kstgive'+i);}
  assert.equal(e.repo.snapshot().snacks.usedToday,3);
  assert.equal((await e.repo.giveSnack('milk','kstfour')).reason,'daily-limit');
  assert.deepEqual(JSON.parse(e.storage.getItem(Care.SNACK_KEY)).transactions.slice(0,2),transactions);
});
test('v2: 기존 식사·간식·장난감 기록을 삭제·재보상하지 않고 마이그레이션',async()=>{
  const storage=new Storage();let now=at();const options={now:()=>now};
  const legacy=Care.repository(storage,{...options,rulesVersion:1});
  await legacy.saveProfile({name:'연탄',gender:'female'});await legacy.feed();
  await legacy.buySnack('milk','buy');await legacy.giveSnack('milk','give');
  const before=legacy.snapshot(),entries=[...storage.data.entries()];
  const modern=Care.repository(storage,options);assert.deepEqual(modern.snapshot().stats,before.stats);
  for(const [key,value]of entries)assert.equal(storage.getItem(key),value);
  assert.deepEqual(modern.snapshot().stats,before.stats);
  await modern.buySnack('milk','newbuy');await modern.giveSnack('milk','newgive');
  assert.deepEqual(modern.snapshot().stats,R.applyEffect(before.stats,{affection:Care.SNACKS.find(s=>s.id==='milk').affection,fullness:5}));
});

test('v2: 규칙적인 식사·산책으로 9일간 훈련하면 5개 개인기를 순서대로 실제 습득',async()=>{
  let roll=0;
  const e=await env({affection:100,fullness:100},()=>roll++%2===0?0:.999);
  const learned=[];
  for(let day=1;day<=9;day++) {
    e.time(at(day,7));await e.repo.feed();
    for(let n=0;n<3;n++) {
      const before=e.repo.snapshot();
      if(!before.training.current) break;
      const id=before.training.current.id;
      const result=await e.repo.train(id,'day'+day+'-'+n);
      assert.equal(result.ok,true,'day '+day+' '+id);
      assert.equal(result.event.gain,20);
      if(result.state.training.mastery[id]===100)learned.push(id);
    }
    await e.repo.completeWalk('walk'+day);
    e.time(at(day,13));await e.repo.feed();
    e.time(at(day,18));await e.repo.feed();
  }
  const s=e.repo.snapshot();
  assert.deepEqual(learned,['sit','paw','down','spin','highfive']);
  assert.equal(s.training.current,null);assert.equal(s.training.learned.length,5);
  for(const value of Object.values(s.training.mastery))assert.equal(value,100);
});
