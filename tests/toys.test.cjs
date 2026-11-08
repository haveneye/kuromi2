const test = require('node:test');
const assert = require('node:assert/strict');
const ModernCare = require('../game-state.js');
const Care = ModernCare;
const Toys = require('../toy-state.js');
process.env.TZ = 'Asia/Seoul';
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const local = (hour, day = 29, minute = 0) => new Date(2026, 9, day, hour, minute);
function setup(hour = 10) {
  const storage = new Storage();
  let now = local(hour);
  let queue = Promise.resolve();
  const withLock = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  const options = { now: () => now, withLock };
  return { storage, options, repo: Care.repository(storage, options), time(date) { now = date; } };
}
test('장난감 10종 가격·친밀도와 독립 테스트 잔액', () => {
  assert.deepEqual(Toys.TOYS.map(t => [t.price, t.affection, t.fullnessLoss]), [[100,1,3],[150,1,3],[200,2,5],[250,2,5],[300,3,7],[350,3,7],[450,4,9],[550,4,9],[650,5,11],[900,6,12]]);
  const s = setup();
  assert.equal(s.repo.toySnapshot().balance, 5000);
  assert.deepEqual(s.repo.toySnapshot().owned, {});
});
test('구매 시 한 번만 차감, 영구 소장, 미구매 놀이 금지', async () => {
  const { repo, storage } = setup();
  assert.equal((await repo.playToy('tennis', 'unowned')).reason, 'not-owned');
  assert.equal((await repo.buyToy('tennis', 'buy')).ok, true);
  assert.equal((await repo.buyToy('tennis', 'buy-again')).reason, 'already-owned');
  assert.equal(repo.toySnapshot().balance, 4900);
  assert(Care.repository(storage).toySnapshot().owned.tennis);
});
test('모든 장난감 구매 잔액과 간식 캐시·해금 데이터 보존', async () => {
  const s = setup();
  s.storage.setItem('sanrio_app_profile_test', '{"points":900,"unlockedCharacters":["kuromi"]}');
  await s.repo.saveProfile({ name: '밤이', gender: 'male' });
  for (const toy of Toys.TOYS) assert((await s.repo.buyToy(toy.id, 'buy-' + toy.id)).ok);
  assert.equal(s.repo.toySnapshot().balance, 1100);
  assert.equal(s.repo.snapshot().snacks.testBalance, 120);
  assert.equal(s.storage.getItem('sanrio_app_profile_test'), '{"points":900,"unlockedCharacters":["kuromi"]}');
});
test('놀이 보상은 하루 합계 10에서 멈추고 한도에 도달하면 중단', async () => {
  const { repo } = setup();
  await repo.buyToy('nosework', 'buy');
  assert.equal((await repo.playToy('nosework', 'play-1')).reward, 6);
  assert.equal((await repo.playToy('nosework', 'play-2')).reward, 4);
  assert.equal((await repo.playToy('nosework', 'play-3')).reason, 'affection-limit');
  assert.equal(repo.toySnapshot().earnedToday, 10);
});
test('친밀도 100 초과 금지 및 기존 식사·간식 보상과 함께 계산', async () => {
  const s = setup(7);
  await s.repo.saveProfile({ name: '밤이', gender: 'female' });
  const saved=JSON.parse(s.storage.getItem(Care.PROFILE_KEY));
  saved.base={affection:98,fullness:100};
  s.storage.setItem(Care.PROFILE_KEY,JSON.stringify(saved));
  for(const key of [Care.Rules.KEY,Care.Rules.ACTION_KEY,Care.Rules.CHECKPOINT_KEY])s.storage.removeItem(key);
  s.repo.snapshot();
  await s.repo.buyToy('nosework', 'buy');
  assert.equal((await s.repo.playToy('nosework', 'play-1')).reward,2);
  assert.equal(s.repo.snapshot().stats.affection,100);
  await s.repo.feed();
  assert.equal(s.repo.snapshot().stats.affection,100);
  const result = await s.repo.playToy('nosework', 'play-at-cap');
  assert.equal(result.reward,0);
  assert.equal(s.repo.snapshot().stats.affection,100);
});
test('수면 경계 06시 포함·22시 제외, 수면 거절 시 기록·친밀도 변화 없음', async () => {
  const s = setup(6);
  await s.repo.buyToy('tennis', 'buy');
  const before = s.storage.getItem(Toys.KEY);
  s.time(new Date(2026,9,29,5,59,59,999));
  assert.equal((await s.repo.playToy('tennis', 'early')).reason, 'sleeping');
  assert.equal(s.storage.getItem(Toys.KEY), before);
  s.time(local(6));
  assert((await s.repo.playToy('tennis', 'awake')).ok);
  s.time(new Date(2026,9,29,21,59,59,999));
  assert((await s.repo.playToy('tennis', 'late')).ok);
  s.time(local(22));
  const saved = s.storage.getItem(Toys.KEY);
  assert.equal((await s.repo.playToy('tennis', 'asleep')).reason, 'sleeping');
  assert.equal(s.storage.getItem(Toys.KEY), saved);
});
test('날짜 변경은 일일 보상만 초기화하고 소유·누적 친밀도 보존', async () => {
  const s = setup();
  await s.repo.buyToy('nosework', 'buy');
  await s.repo.playToy('nosework', 'play');
  s.time(local(0,30));
  assert.equal(s.repo.toySnapshot().earnedToday, 0);
  assert(s.repo.toySnapshot().owned.nosework);
  assert.equal(s.repo.toySnapshot().rewards[0].affection, 6);
  assert.equal((await s.repo.playToy('nosework','night')).reason,'sleeping');
  s.time(local(7,30));
  assert.equal((await s.repo.playToy('nosework','morning')).reward,6);
});
test('다중 탭 동시 구매·놀이와 동일 요청 재시도로 중복 차감·보상 없음', async () => {
  const s = setup();
  const second = Care.repository(s.storage, s.options);
  const purchases = await Promise.all(Array.from({length:20}, (_,i) => (i%2 ? s.repo : second).buyToy('nosework','buy-'+i)));
  assert.equal(purchases.filter(r=>r.ok).length,1);
  assert.equal(s.repo.toySnapshot().balance,4100);
  const plays = await Promise.all(Array.from({length:20}, (_,i) => (i%2 ? s.repo : second).playToy('nosework','play-'+i)));
  assert.equal(plays.filter(r=>r.ok).length,2);
  assert.equal(plays.reduce((n,r)=>n+(r.reward||0),0),10);
  assert.equal((await second.playToy('nosework','play-0')).reason,'duplicate-request');
  assert.equal(Care.repository(s.storage,s.options).toySnapshot().earnedToday,10);
});
test('기록 변조·저장 실패는 덮어쓰지 않고 잔액 유지', async () => {
  const s = setup();
  await s.repo.buyToy('tennis','buy');
  const saved=s.storage.getItem(Toys.KEY);
  s.storage.setItem=()=>{throw new Error('disk full');};
  await assert.rejects(s.repo.buyToy('bone','fail'),/disk full/);
  assert.equal(s.storage.getItem(Toys.KEY),saved);
  assert.equal(s.repo.toySnapshot().balance,4900);
  const bad=new Storage(); bad.setItem(Toys.KEY,'{"version":1,"events":[{}]}');
  assert.throws(()=>Toys.read(bad));
  assert.equal(bad.getItem(Toys.KEY),'{"version":1,"events":[{}]}');
});
test('전체 테스트 초기화는 장난감 보유와 테스트 잔액도 초기화',async()=>{
  const s=setup(7);await s.repo.saveProfile({name:'밤이',gender:'male'});
  await s.repo.buyToy('tennis','buy');await s.repo.playToy('tennis','play');
  await s.repo.resetCareForTesting();
  assert.equal(s.repo.toySnapshot().owned.tennis, undefined);assert.equal(s.repo.toySnapshot().balance,1000);
  assert.equal(s.repo.snapshot().stats.affection,10);
});
test('안전한 브라우저 잠금이 없으면 거래를 비활성화',async()=>{
  const storage=new Storage();const repo=Care.repository(storage,{atomicCommerce:false});
  assert.equal((await repo.buyToy('tennis','buy')).reason,'unsupported-storage');
  assert.equal(storage.getItem(Toys.KEY),null);
});
