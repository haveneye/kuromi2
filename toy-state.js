// Standalone toy catalogue and durable, replayable test-wallet rules. No network calls.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuppyToys = api;
})(globalThis, function () {
  'use strict';
  const KEY = 'our-puppy:v1:toys';
  const INITIAL_POINTS = 5000;
  const RESET_POINTS = 1000;
  const LEGACY_DAILY_LIMIT = 20;
  const DAILY_LIMIT = 10;
  const PLAY_LIMIT = 3;
  const MIN_PLAY_FULLNESS = 20;
  const TOYS = Object.freeze([
    ['tennis', '테니스공', 100, 1, 3, 2, 0, 0, '공을 잡으러 폴짝!', 'bounce'],
    ['bone', '고무 뼈다귀', 150, 1, 3, 0, 1, '뼈다귀를 꼭 물었어요!', 'chew'],
    ['rope', '터그 로프', 200, 2, 5, 4, 1, 0, '영차! 같이 당겨요!', 'tug'],
    ['squeaky', '삑삑이 장난감', 250, 2, 5, 5, 3, 0, '삑삑! 귀를 쫑긋해요!', 'tilt'],
    ['ball', '큰 고무공', 300, 3, 7, 6, 1, 1, '커다란 공을 데굴데굴!', 'roll'],
    ['bear', '곰인형', 350, 3, 7, 7, 2, 0, '곰돌이를 꼬옥 안아요!', 'cuddle'],
    ['disc', '원반', 450, 4, 9, 9, 4, 0, '날아가는 원반을 잡았어요!', 'catch'],
    ['octopus', '문어 인형', 550, 4, 9, 11, 2, 1, '문어 다리를 흔들흔들!', 'shake'],
    ['bubbles', '비눗방울', 650, 5, 11, 13, 4, 1, '반짝이는 방울을 톡톡!', 'bubbles'],
    ['nosework', '노즈워크 장난감', 900, 6, 12, 18, 3, 1, '킁킁! 숨은 보물을 찾았어요!', 'sniff']
  ].map(([id, label, price, affection, fullnessLoss, legacyAffection, column, row, reaction, motion]) => Object.freeze({ id, label, price, affection, fullnessLoss, legacyAffection, column, row, reaction, motion })));
  const korean = now => new Date(+now+9*3600000);
  const dayKey = now => korean(now).toISOString().slice(0,10);
  const awake = now => korean(now).getUTCHours() >= 6 && korean(now).getUTCHours() < 22;
  function read(storage, now = new Date()) {
    const raw = storage.getItem(KEY);
    const ledger = raw === null ? { version: 1, openingBalance:INITIAL_POINTS, events: [] } : JSON.parse(raw);
    if (ledger.version !== 1 || !Array.isArray(ledger.events) || (ledger.openingBalance !== undefined && (!Number.isInteger(ledger.openingBalance)||ledger.openingBalance<0))) throw new Error('장난감 기록을 읽을 수 없어요.');
    const owned = {};
    const ids = new Set();
    const earnedByDay = {};
    const originalEarnedByDay = {};
    const playedByDay = {};
    const rewards = [];
    let balance = ledger.openingBalance ?? INITIAL_POINTS;
    for (const event of ledger.events) {
      const toy = TOYS.find(item => item.id === event.toyId);
      if (!toy || !['buy', 'external-buy', 'play'].includes(event.type) || typeof event.id !== 'string' || !/^[\w-]{1,96}$/.test(event.id) || ids.has(event.id) || !Number.isFinite(Date.parse(event.at)) || !Number.isInteger(event.offset) || Math.abs(event.offset) > 1440) throw new Error('장난감 거래 기록이 올바르지 않아요.');
      const original = new Date(Date.parse(event.at) - event.offset * 60000);
      if (event.day !== original.toISOString().slice(0, 10)) throw new Error('장난감 기록 날짜가 올바르지 않아요.');
      ids.add(event.id);
      if (event.type === 'buy' || event.type === 'external-buy') {
        if (owned[toy.id] || (event.type === 'buy' && balance < toy.price)) throw new Error('장난감 구매 기록을 확인해 주세요.');
        if (event.type === 'buy') balance -= toy.price;
        owned[toy.id] = event.at;
      } else {
        const earned = originalEarnedByDay[event.day] || 0;
        const legacyLimit=event.fullnessLoss===undefined?LEGACY_DAILY_LIMIT:DAILY_LIMIT;
        if (!owned[toy.id] || original.getUTCHours() < 6 || original.getUTCHours() >= 22 || !Number.isInteger(event.reward) || event.reward < 0 || event.reward > toy.legacyAffection || earned + event.reward > legacyLimit || (event.fullnessLoss!==undefined&&(!Number.isInteger(event.fullnessLoss)||event.fullnessLoss<0||event.fullnessLoss>100))) throw new Error('장난감 놀이 기록을 확인해 주세요.');
        originalEarnedByDay[event.day] = earned + event.reward;
        const careDay=dayKey(new Date(event.at));
        earnedByDay[careDay]=(earnedByDay[careDay]||0)+event.reward;
        playedByDay[careDay]=(playedByDay[careDay]||0)+1;
        rewards.push({ at: Date.parse(event.at), affection: event.reward, fullness:event.fullnessLoss||0 });
      }
    }
    const earnedToday = earnedByDay[dayKey(now)] || 0;
    const playedToday=playedByDay[dayKey(now)]||0;
    return { ledger, owned, balance, rewards, earnedToday, remaining: Math.max(0,DAILY_LIMIT - earnedToday), playedToday, playsRemaining:Math.max(0,PLAY_LIMIT-playedToday), sleeping: !awake(now), day: dayKey(now) };
  }
  function transact(storage, type, toyId, requestId, now, currentAffection, rewardPerPlay = null, options = {}) {
    const before = read(storage, now);
    const toy = TOYS.find(item => item.id === toyId);
    if (!toy) return { ok: false, reason: 'invalid-toy' };
    if (typeof requestId !== 'string' || !/^[\w-]{1,96}$/.test(requestId)) return { ok: false, reason: 'invalid-request' };
    if (before.ledger.events.some(event => event.id === requestId)) return { ok: false, reason: 'duplicate-request' };
    if ((type === 'buy' || type === 'external-buy') && before.owned[toyId]) return { ok: false, reason: 'already-owned' };
    if (type === 'buy' && before.balance < toy.price) return { ok: false, reason: 'insufficient-cash' };
    if (type === 'play' && !before.owned[toyId]) return { ok: false, reason: 'not-owned' };
    if (type === 'play' && !awake(now)) return { ok: false, reason: 'sleeping' };
    if (type === 'play' && options.minimumFullness !== undefined && options.currentFullness <= options.minimumFullness) return { ok: false, reason: 'hungry' };
    if (type === 'play' && options.playLimit !== undefined && before.playedToday >= options.playLimit) return { ok: false, reason: 'daily-limit' };
    if (type === 'play' && options.affinityLimit !== undefined && before.earnedToday >= options.affinityLimit) return { ok: false, reason: 'affection-limit' };
    if (!['buy', 'external-buy', 'play'].includes(type)) return { ok: false, reason: 'invalid-action' };
    if (!Number.isFinite(currentAffection) || currentAffection < 0 || currentAffection > 100) throw new Error('친밀도 수치를 확인해 주세요.');
    const reward = type === 'play' ? Math.min(rewardPerPlay ?? toy.affection, before.remaining, 100 - currentAffection) : 0;
    const fullnessLoss=type==='play'?toy.fullnessLoss:0;
    const event = { type, toyId, id: requestId, day: dayKey(now), at: now.toISOString(), offset: -540, reward, fullnessLoss };
    // Wallet debit + ownership, or play + reward, are committed by ONE storage write.
    storage.setItem(KEY, JSON.stringify({ version: 1, openingBalance:before.ledger.openingBalance ?? INITIAL_POINTS, events: [...before.ledger.events, event] }));
    return { ok: true, toy, reward, toys: read(storage, now) };
  }
  return Object.freeze({ KEY, INITIAL_POINTS, RESET_POINTS, DAILY_LIMIT, PLAY_LIMIT, MIN_PLAY_FULLNESS, TOYS, dayKey, awake, read, transact });
});
