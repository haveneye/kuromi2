// Pure care rules and a browser-local event ledger. Loaded as a classic script for file:// support.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./toy-state.js') : root.PuppyToys,
    typeof module === 'object' && module.exports ? require('./care-rules.js') : root.PuppyRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuppyCare = api;
})(globalThis, function (Toys, Rules) {
  'use strict';
  const PREFIX = 'our-puppy:v1:';
  const PROFILE_KEY = PREFIX + 'profile';
  const SNACK_KEY = PREFIX + 'snacks';
  const SNACK_LIMIT = 3;
  const DEMO_CASH = 120;
  const RESET_CASH = 1000;
  const SNACKS = Object.freeze([
    Object.freeze({ id: 'milk', label: '우유껌', price: 30, affection: 2, fullness: 5, icon: 'snack' }),
    Object.freeze({ id: 'cookie', label: '강아지 쿠키', price: 50, affection: 4, fullness: 10, icon: 'cookie' }),
    Object.freeze({ id: 'meat', label: '고기 간식', price: 100, affection: 9, fullness: 20, icon: 'meat' })
  ]);
  const MEALS = Object.freeze([
    Object.freeze({ id: 'breakfast', label: '아침', start: 7, end: 10, time: '07~10시' }),
    Object.freeze({ id: 'lunch', label: '점심', start: 12, end: 15, time: '12~15시' }),
    Object.freeze({ id: 'dinner', label: '저녁', start: 17, end: 20, time: '17~20시' })
  ]);
  const BOND_STAGES = Object.freeze([
    { min: 0, label: '낯가림', emoji: '🥺' },
    { min: 20, label: '익숙한 친구', emoji: '🙂' },
    { min: 40, label: '친한 사이', emoji: '😊' },
    { min: 60, label: '단짝', emoji: '🥰' },
    { min: 80, label: '최고의 가족', emoji: '💖' }
  ]);
  const FULLNESS_STAGES = Object.freeze([
    { min: 0, label: '너무 배고파요', emoji: '😭' },
    { min: 20, label: '배고파요', emoji: '🥺' },
    { min: 40, label: '조금 출출해요', emoji: '🙂' },
    { min: 60, label: '든든해요', emoji: '😊' },
    { min: 80, label: '배불러요', emoji: '😋' }
  ]);
  const RULES = Object.freeze({ mealAffection: 3, mealFullness: 20, missedFullness: 10, neglectedDayAffection: 1, maxNeglectLossPerStreak: 3 });
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const pad = value => String(value).padStart(2, '0');
  function dateKey(date) { return Rules.dayKey(date); }
  function parseDay(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('날짜 형식이 올바르지 않아요.');
    const [year, month, day] = key.split('-').map(Number);
    const date = Rules.boundary(key);
    if (dateKey(date) !== key) throw new Error('저장된 날짜를 확인해 주세요.');
    return date;
  }
  function nextDay(key) {
    return Rules.nextDay(key);
  }
  function boundary(key, hour) {
    return Rules.boundary(key,hour);
  }
  function stageFor(value, stages) {
    const score = clamp(value);
    return { value: score, stage: [...stages].reverse().find(stage => score >= stage.min), next: stages.find(stage => stage.min > score) };
  }
  const getBond = value => stageFor(value, BOND_STAGES);
  const getFullness = value => stageFor(value, FULLNESS_STAGES);
  // Other care actions can use this same bounded effect function when implemented.
  function applyCareEffect(stats, effect) {
    return { affection: clamp(stats.affection + (effect.affection || 0)), fullness: clamp(stats.fullness + (effect.fullness || 0)) };
  }
  function currentMeal(now) {
    const kst = Rules.koreanDate(now);
    const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    return MEALS.find(meal => minutes >= meal.start * 60 && minutes < meal.end * 60) || null;
  }
  function mealStatus(day, meal, completed, now) {
    if (completed) return { status: 'eaten', stateLabel: '먹었어요', emoji: '✅', available: false };
    const today = dateKey(now);
    const ended = day < today || (day === today && now >= boundary(day, meal.end));
    return ended
      ? { status: 'missed', stateLabel: '놓쳤어요', emoji: '😢', available: false }
      : { status: 'pending', stateLabel: '아직이에요', emoji: '🕒', available: day === today && now >= boundary(day, meal.start) };
  }
  function repository(storage, options = {}) {
    const clock = options.now || (() => new Date());
    const withLock = options.withLock || (task => task());
    const atomicCommerce = options.atomicCommerce !== false;
    const modern = options.rulesVersion !== 1;
    function readJSON(key) {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch (_) { throw new Error('저장된 기록을 읽을 수 없어요. 기존 기록은 보관하고 있어요.'); }
    }
    function loadProfile() {
      const saved = readJSON(PROFILE_KEY);
      if (saved === null) return null;
      if (saved.schemaVersion !== 1 || saved.id !== 'main' || !saved.profile || typeof saved.profile.name !== 'string' || !saved.profile.name.trim() || !['male', 'female'].includes(saved.profile.gender) || !Number.isFinite(Date.parse(saved.createdAt)) || !saved.base || !Number.isFinite(saved.base.affection) || !Number.isFinite(saved.base.fullness)) throw new Error('저장된 강아지 정보를 확인할 수 없어요.');
      parseDay(saved.createdDate);
      return saved;
    }
    function eventKey(type, day, mealId) { return `${PREFIX}main:${day}:${mealId}:${type}`; }
    function readEvents() {
      const events = [];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (!key || !key.startsWith(PREFIX + 'main:')) continue;
        const event = readJSON(key);
        if (!event) continue;
        const meal = MEALS.find(item => item.id === event.mealId);
        if (!meal || !['completed', 'missed'].includes(event.type) || !Number.isFinite(Date.parse(event.at)) || !Number.isInteger(event.offset) || Math.abs(event.offset) > 1440 || key !== eventKey(event.type, event.date, event.mealId)) throw new Error('저장된 식사 기록을 확인할 수 없어요.');
        parseDay(event.date);
        // Verify the original local date/time, even if the device timezone later changes.
        const local = new Date(Date.parse(event.at) - event.offset * 60_000);
        const savedDate = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
        const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
        const priorEnd={breakfast:9,lunch:15,dinner:20}[meal.id]*60;
        if (savedDate !== event.date || (event.type === 'completed' && (minutes < meal.start * 60 || minutes >= meal.end * 60)) || (event.type === 'missed' && minutes !== meal.end * 60 && minutes !== priorEnd)) throw new Error('식사 기록의 날짜나 시간이 올바르지 않아요.');
        events.push(event);
      }
      return events;
    }
    function readSnacks(today) {
      const saved = readJSON(SNACK_KEY) || { schemaVersion: 1, openingBalance: DEMO_CASH, transactions: [] };
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.transactions) || (saved.openingBalance !== undefined && (!Number.isInteger(saved.openingBalance) || saved.openingBalance < 0))) throw new Error('저장된 간식 기록을 확인할 수 없어요.');
      const inventory = Object.fromEntries(SNACKS.map(snack => [snack.id, 0]));
      const usageByDate = {};
      const originalUsageByDate = {};
      const ids = new Set();
      let testBalance = saved.openingBalance ?? DEMO_CASH;
      for (const event of saved.transactions) {
        const snack = SNACKS.find(item => item.id === event.snackId);
        if (!snack || !['buy', 'external-buy', 'give'].includes(event.type) || typeof event.id !== 'string' || !event.id || event.id.length > 96 || ids.has(event.id) || !Number.isFinite(Date.parse(event.at)) || !Number.isInteger(event.offset) || Math.abs(event.offset) > 1440) throw new Error('저장된 간식 기록이 올바르지 않아요.');
        parseDay(event.date);
        const local = new Date(Date.parse(event.at) - event.offset * 60_000);
        const originalDate = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
        if (event.date !== originalDate) throw new Error('간식 기록의 현지 날짜가 올바르지 않아요.');
        ids.add(event.id);
        if (event.type === 'buy' || event.type === 'external-buy') {
          if (event.type === 'buy') {
            if (testBalance < snack.price) throw new Error('간식 구매 잔액 기록이 올바르지 않아요.');
            testBalance -= snack.price;
          }
          inventory[snack.id]++;
        } else {
          const used = originalUsageByDate[event.date] || 0;
          if (inventory[snack.id] < 1 || used >= SNACK_LIMIT) throw new Error('간식 보유 수량이나 급여 기록이 올바르지 않아요.');
          inventory[snack.id]--;
          originalUsageByDate[event.date] = used + 1;
          const careDay = modern ? dateKey(new Date(event.at)) : event.date;
          usageByDate[careDay] = (usageByDate[careDay] || 0) + 1;
        }
      }
      const usedToday = usageByDate[today] || 0;
      return { saved, inventory, testBalance, source: 'demo', usedToday, remaining: Math.max(0,SNACK_LIMIT - usedToday), usageByDate, atomicCommerce };
    }
    function settleMissed(saved, now) {
      const today = dateKey(now);
      for (let day = saved.createdDate; day <= today; day = nextDay(day)) {
        for (const meal of MEALS) {
          const end = boundary(day, meal.end);
          // Earlier meals on adoption day cause no penalty.
          if (end > now || end <= new Date(saved.createdAt)) continue;
          const key = eventKey('missed', day, meal.id);
          if (storage.getItem(eventKey('completed', day, meal.id)) !== null || storage.getItem(key) !== null) continue;
          // Separate keys let completion win over a concurrent missed marker at a window boundary.
          storage.setItem(key, JSON.stringify({ type: 'missed', date: day, mealId: meal.id, at: end.toISOString(), offset: -540 }));
        }
      }
    }
    function legacySnapshot(now = clock()) {
      const saved = loadProfile();
      if (!saved) return null;
      settleMissed(saved, now);
      const records = readEvents();
      const history = {};
      for (let day = saved.createdDate; day <= dateKey(now); day = nextDay(day)) history[day] = {};
      for (const event of records) {
        const day = history[event.date] || (history[event.date] = {});
        const previous = day[event.mealId];
        if (!previous || event.type === 'completed') day[event.mealId] = event;
      }
      const changes = [];
      const snacks = readSnacks(dateKey(now));
      const toys = Toys.read(storage, now);
      for (const reward of toys.rewards) changes.push({ at: reward.at, type: 'toy', effect: { affection: reward.affection, fullness: -(reward.fullness||0) } });
      for (const event of snacks.saved.transactions) {
        if (event.type === 'give') {
          const snack = SNACKS.find(item => item.id === event.snackId);
          changes.push({ at: Date.parse(event.at), type: 'snack', effect: { affection: snack.affection, fullness: snack.fullness } });
        }
      }
      for (const [day, meals] of Object.entries(history)) {
        for (const event of Object.values(meals)) changes.push({ at: Date.parse(event.at), type: event.type });
        const fullyMissed = MEALS.every(meal => meals[meal.id]?.type === 'missed');
        if (day > saved.createdDate && fullyMissed) changes.push({ at: boundary(nextDay(day), 0).getTime(), type: 'neglected' });
      }
      const priority = { missed: 0, neglected: 1, completed: 2, snack: 3 };
      changes.sort((a, b) => a.at - b.at || priority[a.type] - priority[b.type]);
      let stats = { affection: clamp(saved.base.affection), fullness: clamp(saved.base.fullness) };
      let neglectLoss = 0;
      for (const change of changes) {
        if (change.type === 'completed') {
          stats = applyCareEffect(stats, { affection: RULES.mealAffection, fullness: RULES.mealFullness });
          neglectLoss = 0;
        } else if (change.type === 'missed') {
          stats = applyCareEffect(stats, { fullness: -RULES.missedFullness });
        } else if (change.type === 'snack') {
          stats = applyCareEffect(stats, change.effect);
        } else if (change.at <= now.getTime() && neglectLoss < RULES.maxNeglectLossPerStreak) {
          stats = applyCareEffect(stats, { affection: -RULES.neglectedDayAffection });
          neglectLoss++;
        }
      }
      const today = dateKey(now);
      const meals = MEALS.map(meal => {
        const record = history[today]?.[meal.id];
        return { ...meal, ...mealStatus(today, meal, record?.type === 'completed', now), record: record || null };
      });
      // Derive the lasting expression from durable feeding facts, not a UI timer.
      // A purchase or toy reward does not count as feeding.
      const mealEvents = Object.values(history).flatMap(day => Object.values(day));
      const latestMissed = Math.max(-Infinity, ...mealEvents.filter(event => event.type === 'missed').map(event => Date.parse(event.at)));
      const latestFed = Math.max(-Infinity,
        ...mealEvents.filter(event => event.type === 'completed').map(event => Date.parse(event.at)),
        ...snacks.saved.transactions.filter(event => event.type === 'give').map(event => Date.parse(event.at)));
      const waitingForFood = Number.isFinite(latestMissed) && latestMissed > latestFed;
      return { ...saved, stats, history, date: today, meals, snacks, toys, waitingForFood };
    }
    function factsFor(state) {
      const meals=Object.values(state.history).flatMap(day=>Object.values(day)).map(e=>({id:'meal:'+e.date+':'+e.mealId+':'+e.type,type:e.type,at:Date.parse(e.at)}));
      const snacks=state.snacks.saved.transactions.filter(e=>e.type==='give').map(e=>{
        const snack=SNACKS.find(item=>item.id===e.snackId);
        return {id:'snack:'+e.id,type:'snack',at:Date.parse(e.at),affection:snack.affection,fullness:snack.fullness};
      });
      const toys=state.toys.ledger.events.filter(e=>e.type==='play').map(e=>({id:'toy:'+e.id,type:'toy',at:Date.parse(e.at),reward:e.reward,fullnessLoss:e.fullnessLoss||0}));
      return [...meals,...snacks,...toys];
    }
    function snapshot(now = clock()) {
      const legacy=legacySnapshot(now);
      if(!legacy||!modern) return legacy;
      const facts=factsFor(legacy);
      const doc=Rules.ensure(storage,legacy,facts,now);
      const computed=Rules.calculate(doc,facts,now);
      const checkpoint={lastCalculatedAt:computed.lastCalculatedAt,stats:computed.stats,lowFullness:computed.lowFullness};
      if(storage.getItem(Rules.CHECKPOINT_KEY)!==JSON.stringify(checkpoint)) storage.setItem(Rules.CHECKPOINT_KEY,JSON.stringify(checkpoint));
      return {...legacy,...computed,rulesVersion:2,newlyAdopted:legacy.careVersion===2&&!doc.actions.length&&!facts.some(e=>e.type==='completed'||e.type==='snack'||e.type==='toy')};
    }
    async function saveProfile(profile) {
      return withLock(() => {
        const name = typeof profile.name === 'string' ? profile.name.trim() : '';
        if (!name || name.length > 12 || !['male', 'female'].includes(profile.gender)) throw new Error('이름과 성별을 확인해 주세요.');
        const now = clock();
        const saved = loadProfile() || { schemaVersion: 1, id: 'main', breed: 'great-dane', growthStage: 'baby', createdAt: now.toISOString(), createdDate: dateKey(now), ...(modern?{careVersion:2}:{}), base: modern?{affection:Rules.SETTINGS.initialAffection,fullness:Rules.SETTINGS.initialFullness}:{ affection: 65, fullness: 80 } };
        saved.profile = { name, gender: profile.gender };
        storage.setItem(PROFILE_KEY, JSON.stringify(saved));
        return snapshot(now);
      });
    }
    async function feed() {
      return withLock(() => {
        // Take the current local time after waiting for the cross-tab lock.
        const now = clock();
        const saved = loadProfile();
        if (!saved) return { ok: false, reason: 'no-profile', state: null };
        snapshot(now); // Establish migration before granting a new meal reward.
        const meal = currentMeal(now);
        if (!meal) return { ok: false, reason: 'outside-window', state: snapshot(now) };
        const day = dateKey(now);
        const key = eventKey('completed', day, meal.id);
        if (storage.getItem(key) !== null) return { ok: false, reason: 'already-eaten', meal, state: snapshot(now) };
        const event = { type: 'completed', date: day, mealId: meal.id, at: now.toISOString(), offset: -540 };
        // Completion and its reward are ONE durable event, never two separate increments.
        // The same date/meal key is folded once even without Web Locks, including two tabs.
        storage.setItem(key, JSON.stringify(event));
        return { ok: true, meal, state: snapshot(now) };
      });
    }
    async function resetCareForTesting() {
      return withLock(() => {
        const saved = loadProfile();
        if (!saved) return null;
        const now = clock();
        const keys = Array.from({length:storage.length},(_,i)=>storage.key(i));
        for(const key of keys) if(key?.startsWith(PREFIX+'main:')) storage.removeItem(key);
        storage.setItem(SNACK_KEY, JSON.stringify({schemaVersion:1,openingBalance:RESET_CASH,transactions:[]}));
        storage.setItem(Toys.KEY,JSON.stringify({version:1,openingBalance:Toys.RESET_POINTS,events:[]}));
        storage.removeItem(Rules.KEY);
        storage.removeItem(Rules.ACTION_KEY);
        storage.removeItem(Rules.CHECKPOINT_KEY);
        saved.createdAt=now.toISOString();
        saved.createdDate=dateKey(now);
        saved.growthStage='baby';
        saved.breed='great-dane';
        saved.careVersion=2;
        saved.base={affection:Rules.SETTINGS.initialAffection,fullness:Rules.SETTINGS.initialFullness};
        storage.setItem(PROFILE_KEY,JSON.stringify(saved));
        return snapshot(now);
      });
    }
    async function snackTransaction(type, snackId, requestId) {
      if (!atomicCommerce) return { ok: false, reason: 'unsupported-storage' };
      return withLock(() => {
        const now = clock();
        if (!loadProfile()) return { ok: false, reason: 'no-profile', state: null };
        const snack = SNACKS.find(item => item.id === snackId);
        if (!snack) return { ok: false, reason: 'invalid-snack', state: snapshot(now) };
        if (typeof requestId !== 'string' || !requestId || requestId.length > 96) return { ok: false, reason: 'invalid-request', state: snapshot(now) };
        // Validate the existing care ledger BEFORE writing any purchase or use.
        const before = snapshot(now);
        const ledger = before.snacks;
        if (ledger.saved.transactions.some(event => event.id === requestId)) return { ok: false, reason: 'duplicate-request', state: before };
        if (type === 'buy' && ledger.testBalance < snack.price) return { ok: false, reason: 'insufficient-cash', state: before };
        if (type === 'give' && ledger.usedToday >= SNACK_LIMIT) return { ok: false, reason: 'daily-limit', state: before };
        if (type === 'give' && ledger.inventory[snack.id] < 1) return { ok: false, reason: 'out-of-stock', state: before };
        const event = { id: requestId, type: type === 'buy-external' ? 'external-buy' : type, snackId, date: dateKey(now), at: now.toISOString(), offset: -540 };
        // One serialized write commits cash/stock OR stock/daily-count/reward together.
        // The immutable transaction ID makes a retried request idempotent.
        storage.setItem(SNACK_KEY, JSON.stringify({ schemaVersion: 1, openingBalance:ledger.saved.openingBalance ?? DEMO_CASH, transactions: [...ledger.saved.transactions, event] }));
        return { ok: true, snack, state: snapshot(now) };
      });
    }
    const buySnack = (snackId, requestId) => snackTransaction('buy', snackId, requestId);
    const buySnackExternal = (snackId, requestId) => snackTransaction('buy-external', snackId, requestId);
    const giveSnack = (snackId, requestId) => snackTransaction('give', snackId, requestId);
    const toySnapshot = (now = clock()) => Toys.read(storage, now);
    async function toyTransaction(type, toyId, requestId) {
      if (!atomicCommerce) return { ok: false, reason: 'unsupported-storage' };
      return withLock(() => {
        const now = clock();
        const before = snapshot(now);
        const toyState = Toys.read(storage, now);
        const affection = before ? before.stats.affection : clamp(65 + toyState.rewards.reduce((sum, item) => sum + item.affection, 0));
        const fullness = before ? before.stats.fullness : 80;
        const result = Toys.transact(storage, type, toyId, requestId, now, affection, null, modern ? {
          playLimit:Toys.PLAY_LIMIT, affinityLimit:Toys.DAILY_LIMIT, minimumFullness:Toys.MIN_PLAY_FULLNESS, currentFullness:fullness
        } : {});
        return { ...result, state: snapshot(now), toys: Toys.read(storage, now) };
      });
    }
    const buyToy = (toyId, requestId) => toyTransaction('buy', toyId, requestId);
    const buyToyExternal = (toyId, requestId) => toyTransaction('external-buy', toyId, requestId);
    async function importExternalPurchases(receipts) {
      if (!atomicCommerce || !Array.isArray(receipts)) return { ok: false, reason: 'unsupported-storage' };
      return withLock(() => {
        if (!loadProfile()) return { ok: false, reason: 'no-profile', state: null };
        const now = clock();
        const snackSaved = readJSON(SNACK_KEY) || { schemaVersion: 1, openingBalance: DEMO_CASH, transactions: [] };
        const toySaved = readJSON(Toys.KEY) || { version: 1, openingBalance: Toys.INITIAL_POINTS, events: [] };
        const snackIds = new Set(snackSaved.transactions.map(event => event.id));
        const toyIds = new Set(toySaved.events.map(event => event.id));
        const owned = new Set(Object.keys(Toys.read(storage, now).owned));
        let snacksChanged = false;
        let toysChanged = false;
        for (const receipt of receipts) {
          if (!receipt || typeof receipt.requestId !== 'string' || !/^[\w-]{1,96}$/.test(receipt.requestId) || !Number.isFinite(Date.parse(receipt.createdAt))) continue;
          if (receipt.kind === 'snack') {
            const snack = SNACKS.find(item => item.id === receipt.itemId);
            if (!snack || snackIds.has(receipt.requestId) || receipt.amount !== snack.price) continue;
            const at = new Date(receipt.createdAt).toISOString();
            snackSaved.transactions.push({ id: receipt.requestId, type: 'external-buy', snackId: snack.id, date: dateKey(new Date(at)), at, offset: -540 });
            snackIds.add(receipt.requestId);
            snacksChanged = true;
          } else if (receipt.kind === 'toy') {
            const toy = Toys.TOYS.find(item => item.id === receipt.itemId);
            if (!toy || toyIds.has(receipt.requestId) || owned.has(toy.id) || receipt.amount !== toy.price) continue;
            const at = new Date(receipt.createdAt).toISOString();
            toySaved.events.push({ type: 'external-buy', toyId: toy.id, id: receipt.requestId, day: Toys.dayKey(new Date(at)), at, offset: -540, reward: 0, fullnessLoss: 0 });
            toyIds.add(receipt.requestId);
            owned.add(toy.id);
            toysChanged = true;
          }
        }
        if (snacksChanged) storage.setItem(SNACK_KEY, JSON.stringify(snackSaved));
        if (toysChanged) storage.setItem(Toys.KEY, JSON.stringify(toySaved));
        return { ok: true, imported: snacksChanged || toysChanged, state: snapshot(now) };
      });
    }
    const playToy = (toyId, requestId) => toyTransaction('play', toyId, requestId);
    async function activity(type,trickId,requestId) {
      if(!atomicCommerce) return {ok:false,reason:'unsupported-storage'};
      return withLock(()=>{
        const now=clock(), state=snapshot(now);
        if(!state) return {ok:false,reason:'no-profile'};
        if(!modern) return {ok:false,reason:'legacy-rules',state};
        const doc=Rules.read(storage);
        if(typeof requestId!=='string'||!/^[\w-]{1,96}$/.test(requestId)) return {ok:false,reason:'invalid-request',state};
        if(doc.actions.some(e=>e.id===requestId)) return {ok:false,reason:'duplicate-request',state};
        if(!Rules.awake(now)) return {ok:false,reason:'sleeping',state};
        if(type==='walk'&&state.walkedToday) return {ok:false,reason:'already-walked',state};
        if(type==='train') {
          if(state.training.usedToday>=Rules.SETTINGS.trainingLimit) return {ok:false,reason:'daily-limit',state};
          if(!state.training.current||state.training.current.id!==trickId) return {ok:false,reason:'sequence',state};
          if(state.stats.affection<state.training.current.bond) return {ok:false,reason:'bond-required',state};
        }
        const random=options.random||Math.random;
        const success=type==='train'&&random()<Rules.SETTINGS.successChance;
        const gain=success?Rules.SETTINGS.masteryMin+Math.min(Rules.SETTINGS.masteryMax-Rules.SETTINGS.masteryMin,Math.floor(random()*(Rules.SETTINGS.masteryMax-Rules.SETTINGS.masteryMin+1))):0;
        const event={id:requestId,at:+now,type,...(type==='train'?{trickId,success,gain}:{})};
        storage.setItem(Rules.ACTION_KEY,JSON.stringify({version:2,actions:[...doc.actions,event]}));
        return {ok:true,event,state:snapshot(now)};
      });
    }
    const train=(trickId,requestId)=>activity('train',trickId,requestId);
    const completeWalk=requestId=>activity('walk',null,requestId);
    return { loadProfile, snapshot, saveProfile, feed, resetCareForTesting, buySnack, buySnackExternal, giveSnack, toySnapshot, buyToy, buyToyExternal, importExternalPurchases, playToy, train, completeWalk };
  }
  return Object.freeze({ PREFIX, PROFILE_KEY, SNACK_KEY, SNACKS, SNACK_LIMIT, DEMO_CASH, RESET_CASH, MEALS, BOND_STAGES, FULLNESS_STAGES, RULES, Rules, clamp, dateKey, currentMeal, mealStatus, getBond, getFullness, applyCareEffect, repository });
});
