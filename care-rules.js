// Local v2 rules. Replays durable facts; never contacts Firebase or a cash service.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuppyRules = api;
})(globalThis, function() {
  'use strict';
  const KEY = 'our-puppy:v2:care';
  const ACTION_KEY = 'our-puppy:v2:activities';
  const CHECKPOINT_KEY = 'our-puppy:v2:checkpoint';
  const HOUR = 3600000;
  const SETTINGS = Object.freeze({ initialAffection:10, initialFullness:70, mealAffection:1, mealFullness:30,
    missedAffection:-6, missedFullness:-15, snackAffection:4, snackFullness:5,
    walkAffection:3, walkFullness:-10, toyAffection:1, toyFullness:-5,
    trainAffection:1, trainFullness:-3, hourlyFullness:-2, dailyAffection:-3,
    missedWalkAffection:-2, lowHours:3, lowAffection:-2, veryLowAffection:-3,
    trainingLimit:3, successChance:.8, masteryMin:10, masteryMax:20, sleepStart:22, sleepEnd:6 });
  const TRICKS = Object.freeze([
    {id:'sit',label:'앉아',bond:30}, {id:'paw',label:'손',bond:50},
    {id:'down',label:'엎드려',bond:70}, {id:'spin',label:'빙글빙글',bond:80},
    {id:'highfive',label:'하이파이브',bond:90}
  ].map(Object.freeze));
  const clamp = n => Math.min(100, Math.max(0,n));
  const koreanDate = date => new Date(+date + 9*HOUR);
  const dayKey = date => koreanDate(date).toISOString().slice(0,10);
  const boundary = (day,hour=0) => new Date(Date.parse(day+'T00:00:00+09:00')+hour*HOUR);
  const nextDay = day => dayKey(new Date(+boundary(day)+24*HOUR));
  const awake = date => {const h=koreanDate(date).getUTCHours(); return h>=SETTINGS.sleepEnd&&h<SETTINGS.sleepStart;};
  const band = n => n>=70 ? 0 : n<=20 ? 2 : 1;
  function applyEffect(stats,effect) {
    return {affection:clamp(stats.affection+(effect.affection||0)),fullness:clamp(stats.fullness+(effect.fullness||0))};
  }
  function read(storage) {
    const raw=storage.getItem(KEY);
    if(raw===null) return null;
    let doc;
    try {doc=JSON.parse(raw);} catch(_){throw new Error('새 돌봄 기록을 읽을 수 없어요.');}
    if(doc.version!==2||!Number.isFinite(doc.startedAt)||!doc.base||!Number.isFinite(doc.base.affection)||!Number.isFinite(doc.base.fullness)||!Array.isArray(doc.excluded)||!Array.isArray(doc.actions)) throw new Error('새 돌봄 기록이 올바르지 않아요.');
    const actionRaw=storage.getItem(ACTION_KEY);
    if(actionRaw!==null) {
      let ledger;
      try{ledger=JSON.parse(actionRaw);}catch(_){throw new Error('훈련·산책 기록을 읽을 수 없어요.');}
      if(ledger.version!==2||!Array.isArray(ledger.actions))throw new Error('훈련·산책 기록이 올바르지 않아요.');
      doc.actions=ledger.actions;
    }
    const ids=new Set();
    const dailyTraining={}, dailyWalks=new Set();
    for(const e of doc.actions) {
      if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||!Number.isFinite(e.at)||e.at<doc.startedAt||!['train','walk'].includes(e.type)) throw new Error('훈련·산책 기록이 올바르지 않아요.');
      ids.add(e.id);
      if(e.type==='train'&&(!TRICKS.some(t=>t.id===e.trickId)||typeof e.success!=='boolean'||!Number.isInteger(e.gain)||(e.success?(e.gain<SETTINGS.masteryMin||e.gain>SETTINGS.masteryMax):e.gain!==0))) throw new Error('훈련 숙련도 기록이 올바르지 않아요.');
      const day=dayKey(new Date(e.at));
      if(e.type==='train' && (dailyTraining[day]=(dailyTraining[day]||0)+1)>SETTINGS.trainingLimit) throw new Error('훈련 횟수 기록이 올바르지 않아요.');
      if(e.type==='walk') {if(dailyWalks.has(day))throw new Error('산책 횟수 기록이 올바르지 않아요.');dailyWalks.add(day);}
    }
    return doc;
  }
  // Fixed hourly ticks start at adoption/migration. Low-fullness clocks restart at
  // the exact action or tick that crosses a band. Only one band runs at a time.
  function calculate(doc, facts, now) {
    const end=Math.max(doc.startedAt,+now);
    const excluded=new Set(doc.excluded);
    const events=facts.filter(e=>!excluded.has(e.id)&&e.at>=doc.startedAt&&e.at<=end).concat(doc.actions.filter(e=>e.at<=end));
    const walks=new Set(doc.actions.filter(e=>e.type==='walk'&&e.at<=end).map(e=>dayKey(new Date(e.at))));
    for(let day=dayKey(new Date(doc.startedAt)); +boundary(nextDay(day))<=end; day=nextDay(day)) {
      events.push({id:'daily:'+day,at:+boundary(nextDay(day)),type:'daily',missedWalk:!walks.has(day)});
    }
    const priority={hour:0,daily:1,missed:2,completed:3,snack:4,toy:5,walk:6,train:7};
    events.sort((a,b)=>a.at-b.at||(priority[a.type]??9)-(priority[b.type]??9)||a.id.localeCompare(b.id));
    let stats={affection:clamp(doc.base.affection),fullness:clamp(doc.base.fullness)};
    let hungerBand=band(stats.fullness), lowSince=hungerBand?doc.startedAt:null;
    let tick=doc.startedAt+HOUR, cursor=doc.startedAt, i=0, trainingToday=0;
    const mastery=Object.fromEntries(TRICKS.map(t=>[t.id,0]));
    let lastTraining=null;
    function affect(effect,at) {
      stats=applyEffect(stats,effect);
      const next=band(stats.fullness);
      if(next!==hungerBand){hungerBand=next;lowSince=next?at:null;}
    }
    while(cursor<end||i<events.length&&events[i].at<=end) {
      const lowDue=lowSince===null?Infinity:lowSince+SETTINGS.lowHours*HOUR;
      const at=Math.min(tick,lowDue,events[i]?.at??Infinity);
      if(at>end) break;
      cursor=at;
      // A penalty becoming due exactly at a feeding time has already elapsed.
      if(lowDue===at){affect({affection:hungerBand===2?SETTINGS.veryLowAffection:SETTINGS.lowAffection},at);lowSince=at;}
      if(tick===at){affect({fullness:SETTINGS.hourlyFullness},at);tick+=HOUR;}
      while(i<events.length&&events[i].at===at) {
        const e=events[i++];
        if(e.type==='completed') affect({affection:SETTINGS.mealAffection,fullness:SETTINGS.mealFullness},at);
        else if(e.type==='missed') affect({affection:SETTINGS.missedAffection,fullness:SETTINGS.missedFullness},at);
        else if(e.type==='snack') affect({affection:e.affection??SETTINGS.snackAffection,fullness:e.fullness??SETTINGS.snackFullness},at);
        else if(e.type==='toy') affect({affection:e.reward||0,fullness:-(e.fullnessLoss||0)},at);
        else if(e.type==='walk') affect({affection:SETTINGS.walkAffection,fullness:SETTINGS.walkFullness},at);
        else if(e.type==='daily') affect({affection:SETTINGS.dailyAffection+(e.missedWalk?SETTINGS.missedWalkAffection:0)},at);
        else if(e.type==='train') {
          if(dayKey(new Date(at))===dayKey(now)) trainingToday++;
          if(e.success) mastery[e.trickId]=clamp(mastery[e.trickId]+e.gain);
          affect({affection:e.success?SETTINGS.trainAffection:0,fullness:SETTINGS.trainFullness},at);
          lastTraining=e;
        }
      }
    }
    const current=TRICKS.find(t=>mastery[t.id]<100)||null;
    return {stats,lastCalculatedAt:new Date(end).toISOString(),lowFullness:{band:hungerBand,since:lowSince},
      training:{mastery,current,usedToday:trainingToday,remaining:Math.max(0,SETTINGS.trainingLimit-trainingToday),
        learned:TRICKS.filter(t=>mastery[t.id]>=100).map(t=>t.id),lastResult:lastTraining,
        available:!!current&&stats.affection>=current.bond&&trainingToday<SETTINGS.trainingLimit},
      walkedToday:walks.has(dayKey(now))};
  }
  function ensure(storage,legacy,facts,now) {
    let doc=read(storage);
    if(!doc) {
      const fresh=legacy.careVersion===2;
      doc={version:2,startedAt:fresh?Date.parse(legacy.createdAt):+now,base:{...(fresh?legacy.base:legacy.stats)},
        excluded:fresh?[]:facts.map(e=>e.id),actions:[],migratedFrom:fresh?null:1};
      storage.setItem(KEY,JSON.stringify(doc));
    }
    return doc;
  }
  return Object.freeze({KEY,ACTION_KEY,CHECKPOINT_KEY,SETTINGS,TRICKS,HOUR,dayKey,boundary,nextDay,koreanDate,awake,applyEffect,read,calculate,ensure});
});
