const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Seoul';
const ModernCare = require('../game-state.js');
// Historical v1 ledger scenarios; current care rules are covered in care-v2.test.cjs.
const Care = {...ModernCare, repository:(storage,options={})=>ModernCare.repository(storage,{rulesVersion:1,...options})};
class Storage {
  constructor() { this.data = new Map(); this.failWrites = false; }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.failWrites) throw new Error('Quota exceeded'); this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const local = (hour = 6, day = 28) => new Date(2026, 9, day, hour);
async function setup() {
  const storage = new Storage();
  let now = local();
  const options = { now: () => new Date(now) };
  const repo = Care.repository(storage, options);
  await repo.saveProfile({ name: '구름', gender: 'female' });
  let id = 0;
  return { storage, repo, options, setTime(value) { now = value; }, buy(snack = 'milk') { return repo.buySnack(snack, 'buy-' + ++id); }, give(snack = 'milk') { return repo.giveSnack(snack, 'give-' + ++id); } };
}

test('간식 세 종류 가격·친밀도·포만도는 최신 설정 기준', () => {
  assert.deepEqual(Care.SNACKS.map(({ id, price, affection, fullness }) => [id, price, affection, fullness]), [['milk', 30, 2, 5], ['cookie', 50, 4, 10], ['meat', 100, 9, 20]]);
});
test('기존 강아지 저장 정보는 그대로 사용하며 간식은 보유 0개로 시작', async () => {
  const env = await setup();
  const original = env.storage.getItem(Care.PROFILE_KEY);
  const state = env.repo.snapshot();
  assert.deepEqual(state.snacks.inventory, { milk: 0, cookie: 0, meat: 0 });
  assert.equal(state.snacks.testBalance, 120);
  assert.equal(state.snacks.source, 'demo');
  assert.equal(env.storage.getItem(Care.PROFILE_KEY), original);
  assert.equal(env.storage.getItem(Care.SNACK_KEY), null);
});
test('구매는 테스트 캐시와 보유 수량만 변경, 급여 횟수·보상 변화 없음', async () => {
  const env = await setup();
  const before = env.repo.snapshot();
  const result = await env.buy('cookie');
  assert.equal(result.ok, true);
  assert.equal(result.state.snacks.testBalance, 70);
  assert.equal(result.state.snacks.inventory.cookie, 1);
  assert.equal(result.state.snacks.usedToday, 0);
  assert.deepEqual(result.state.stats, before.stats);
});
test('실제 급여 때만 1개 차감, 횟수와 해당 종류 보상 지급', async () => {
  for (const snack of Care.SNACKS) {
    const env = await setup();
    await env.buy(snack.id);
    const result = await env.give(snack.id);
    assert.equal(result.ok, true);
    assert.equal(result.state.snacks.inventory[snack.id], 0);
    assert.equal(result.state.snacks.usedToday, 1);
    assert.deepEqual(result.state.stats, { affection: 65 + snack.affection, fullness: 80 + snack.fullness });
  }
});
test('서로 다른 종류도 합산하여 하루 총 3개 제한', async () => {
  const env = await setup();
  for (const kind of ['milk', 'cookie', 'milk']) await env.buy(kind);
  for (const kind of ['milk', 'cookie', 'milk']) assert.equal((await env.give(kind)).ok, true);
  const before = env.repo.snapshot();
  const fourth = await env.give('cookie');
  assert.equal(fourth.reason, 'daily-limit');
  assert.equal(fourth.state.snacks.usedToday, 3);
  assert.deepEqual(fourth.state.stats, before.stats);
  assert.deepEqual(fourth.state.snacks.inventory, before.snacks.inventory);
});
test('급여 3회 완료 후에도 구매 가능, 구매 자체에 하루 제한 없음', async () => {
  const env = await setup();
  for (let i = 0; i < 3; i++) await env.buy();
  for (let i = 0; i < 3; i++) await env.give();
  const fourthBuy = await env.buy();
  assert.equal(fourthBuy.ok, true);
  assert.equal(fourthBuy.state.snacks.testBalance, 0);
  assert.equal(fourthBuy.state.snacks.inventory.milk, 1);
  assert.equal(fourthBuy.state.snacks.usedToday, 3);
});
test('수량 또는 캐시 부족 시 아무것도 차감·지급하지 않음', async () => {
  const env = await setup();
  assert.equal((await env.give()).reason, 'out-of-stock');
  assert.equal(env.repo.snapshot().snacks.usedToday, 0);
  await env.buy('meat');
  const before = env.repo.snapshot();
  assert.equal((await env.buy('milk')).reason, 'insufficient-cash');
  const after = env.repo.snapshot();
  assert.deepEqual(after.snacks, before.snacks);
  assert.deepEqual(after.stats, before.stats);
});
test('동일 요청 재시도는 구매·급여·보상을 중복 적용하지 않음', async () => {
  const env = await setup();
  assert.equal((await env.repo.buySnack('milk', 'same-buy')).ok, true);
  for (let i = 0; i < 10; i++) assert.equal((await env.repo.buySnack('milk', 'same-buy')).reason, 'duplicate-request');
  assert.equal(env.repo.snapshot().snacks.testBalance, 90);
  assert.equal((await env.repo.giveSnack('milk', 'same-give')).ok, true);
  for (let i = 0; i < 10; i++) assert.equal((await env.repo.giveSnack('milk', 'same-give')).reason, 'duplicate-request');
  assert.deepEqual(env.repo.snapshot().stats, { affection: 67, fullness: 85 });
  assert.equal(env.repo.snapshot().snacks.usedToday, 1);
});
test('여러 탭에서 동시 급여 20회 요청해도 3회까지만 처리', async () => {
  const env = await setup();
  for (let i = 0; i < 4; i++) await env.buy();
  let queue = Promise.resolve();
  const withLock = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const tabs = [Care.repository(env.storage, { ...env.options, withLock }), Care.repository(env.storage, { ...env.options, withLock })];
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => tabs[i % 2].giveSnack('milk', 'parallel-' + i)));
  assert.equal(results.filter(item => item.ok).length, 3);
  assert.equal(tabs[0].snapshot().snacks.inventory.milk, 1);
  assert.deepEqual(tabs[1].snapshot().stats, { affection: 71, fullness: 95 });
});
test('여러 탭의 동시 구매는 테스트 잔액을 초과 차감하지 않음', async () => {
  const env = await setup();
  let queue = Promise.resolve();
  const withLock = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const repo = Care.repository(env.storage, { ...env.options, withLock });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.buySnack('meat', 'purchase-' + i)));
  assert.equal(results.filter(item => item.ok).length, 1);
  assert.equal(repo.snapshot().snacks.testBalance, 20);
  assert.equal(repo.snapshot().snacks.inventory.meat, 1);
});
test('새로고침·재실행에서도 급여 횟수, 보유 수량, 잔액, 보상 유지', async () => {
  const env = await setup();
  await env.buy(); await env.buy(); await env.give();
  const reopened = Care.repository(env.storage, env.options);
  const state = reopened.snapshot();
  assert.equal(state.snacks.usedToday, 1);
  assert.equal(state.snacks.inventory.milk, 1);
  assert.equal(state.snacks.testBalance, 60);
  assert.deepEqual(state.stats, { affection: 67, fullness: 85 });
  for (let i = 0; i < 10; i++) assert.equal(reopened.snapshot().stats.affection, 67);
});
test('현지 날짜가 바뀌면 횟수 0부터, 재고와 과거 급여 기록 보존', async () => {
  const env = await setup();
  for (let i = 0; i < 4; i++) await env.buy();
  for (let i = 0; i < 3; i++) await env.give();
  env.setTime(local(0, 29));
  const nextDay = env.repo.snapshot();
  assert.equal(nextDay.snacks.usedToday, 0);
  assert.equal(nextDay.snacks.remaining, 3);
  assert.equal(nextDay.snacks.inventory.milk, 1);
  assert.equal(nextDay.snacks.usageByDate['2026-10-28'], 3);
  assert.equal((await env.give()).ok, true);
  assert.equal(env.repo.snapshot().snacks.usageByDate['2026-10-29'], 1);
});
test('잠금 대기 중 자정이 지나면 실제 처리한 날짜로 급여 저장', async () => {
  const env = await setup();
  await env.buy();
  const waiting = Care.repository(env.storage, { ...env.options, withLock: task => { env.setTime(local(0, 29)); return task(); } });
  const result = await waiting.giveSnack('milk', 'midnight');
  assert.equal(result.ok, true);
  assert.equal(result.state.snacks.usageByDate['2026-10-29'], 1);
  assert.equal(result.state.snacks.usageByDate['2026-10-28'], undefined);
});
test('전체 초기화는 간식 횟수·재고·보상을 지우고 테스트 잔액 복원', async () => {
  const env = await setup();
  await env.buy(); await env.give();
  const before = env.repo.snapshot();
  const after = await env.repo.resetCareForTesting();
  assert.equal(before.snacks.usedToday, 1);
  assert.equal(after.snacks.usedToday, 0);
  assert.equal(after.snacks.testBalance, 1000);
  assert.deepEqual(after.snacks.inventory, { milk: 0, cookie: 0, meat: 0 });
  assert.deepEqual(after.stats, { affection: 10, fullness: 70 });
  assert.deepEqual(JSON.parse(env.storage.getItem(Care.SNACK_KEY)), { schemaVersion: 1, openingBalance: 1000, transactions: [] });
  const reopened = Care.repository(env.storage, env.options);
  assert.equal(reopened.snapshot().snacks.testBalance, 1000);
  assert.equal(reopened.snapshot().snacks.usedToday, 0);
});
test('저장 실패 시 구매와 급여가 부분 적용되지 않음', async () => {
  const env = await setup();
  env.storage.failWrites = true;
  await assert.rejects(() => env.buy(), /Quota/);
  env.storage.failWrites = false;
  assert.equal(env.repo.snapshot().snacks.testBalance, 120);
  await env.buy();
  const before = env.repo.snapshot();
  env.storage.failWrites = true;
  await assert.rejects(() => env.give(), /Quota/);
  env.storage.failWrites = false;
  assert.deepEqual(env.repo.snapshot().snacks, before.snacks);
  assert.deepEqual(env.repo.snapshot().stats, before.stats);
});
test('프로필 없음·잘못된 종류·안전한 잠금 미지원은 거래하지 않음', async () => {
  const storage = new Storage();
  const repo = Care.repository(storage, { now: () => local() });
  assert.equal((await repo.buySnack('milk', 'no-profile')).reason, 'no-profile');
  assert.equal(storage.length, 0);
  await repo.saveProfile({ name: '구름', gender: 'male' });
  assert.equal((await repo.giveSnack('unknown', 'bad-kind')).reason, 'invalid-snack');
  const unsupported = Care.repository(storage, { now: () => local(), atomicCommerce: false });
  assert.equal((await unsupported.buySnack('milk', 'no-lock')).reason, 'unsupported-storage');
  assert.equal(storage.getItem(Care.SNACK_KEY), null);
});
test('간식 효과도 0~100 범위를 유지', async () => {
  const env = await setup();
  const saved = JSON.parse(env.storage.getItem(Care.PROFILE_KEY));
  saved.base = { affection: 99, fullness: 99 };
  env.storage.setItem(Care.PROFILE_KEY, JSON.stringify(saved));
  await env.buy('meat');
  assert.deepEqual((await env.give('meat')).state.stats, { affection: 100, fullness: 100 });
});
test('손상된 간식 저장 내용은 덮어쓰지 않음', async () => {
  const env = await setup();
  env.storage.setItem(Care.SNACK_KEY, '{broken');
  await assert.rejects(() => env.buy(), /기록/);
  assert.equal(env.storage.getItem(Care.SNACK_KEY), '{broken');
});
