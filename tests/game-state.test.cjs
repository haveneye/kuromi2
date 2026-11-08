const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Seoul';
// Preserve historical v1 regression scenarios; v2 behavior has a dedicated suite.
const ModernCare = require('../game-state.js');
const Care = {...ModernCare, repository:(storage,options={})=>ModernCare.repository(storage,{rulesVersion:1,...options})};

class MemoryStorage {
  constructor() { this.items = new Map(); this.failWrites = false; }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  removeItem(key) { this.items.delete(key); }
  setItem(key, value) { if (this.failWrites) throw new Error('Quota exceeded'); this.items.set(key, String(value)); }
}
const local = (hour = 0, minute = 0, day = 28, second = 0, ms = 0) => new Date(2026, 9, day, hour, minute, second, ms);
function setup(initial = local(6)) {
  const storage = new MemoryStorage();
  let now = initial;
  const options = { now: () => new Date(now) };
  const repo = Care.repository(storage, options);
  return { storage, repo, options, setTime(value) { now = value; } };
}
const profile = { name: '구름', gender: 'female' };

test('친밀도 모든 단계 경계와 이모티콘, 숫자 범위', () => {
  const bands = [[0, 19, '낯가림', '🥺'], [20, 39, '익숙한 친구', '🙂'], [40, 59, '친한 사이', '😊'], [60, 79, '단짝', '🥰'], [80, 100, '최고의 가족', '💖']];
  for (const [start, end, label, emoji] of bands) for (const score of [start, end]) {
    assert.equal(Care.getBond(score).stage.label, label);
    assert.equal(Care.getBond(score).stage.emoji, emoji);
  }
  assert.equal(Care.getBond(-5).value, 0);
  assert.equal(Care.getBond(150).value, 100);
  assert.equal(Care.getBond(100).next, undefined);
});
test('포만도 모든 단계 경계와 이모티콘', () => {
  const bands = [[0, 19, '너무 배고파요', '😭'], [20, 39, '배고파요', '🥺'], [40, 59, '조금 출출해요', '🙂'], [60, 79, '든든해요', '😊'], [80, 100, '배불러요', '😋']];
  for (const [start, end, label, emoji] of bands) for (const score of [start, end]) {
    assert.equal(Care.getFullness(score).stage.label, label);
    assert.equal(Care.getFullness(score).stage.emoji, emoji);
  }
});
test('모든 돌봄 효과는 0~100으로 제한', () => {
  assert.deepEqual(Care.applyCareEffect({ affection: 99, fullness: 95 }, { affection: 3, fullness: 20 }), { affection: 100, fullness: 100 });
  assert.deepEqual(Care.applyCareEffect({ affection: 0, fullness: 5 }, { affection: -1, fullness: -10 }), { affection: 0, fullness: 0 });
});
test('세 식사 시작 포함 / 종료 제외, 밀리초 경계', () => {
  for (const meal of Care.MEALS) {
    assert.equal(Care.currentMeal(local(meal.start - 1, 59, 28, 59, 999)), null);
    assert.equal(Care.currentMeal(local(meal.start)).id, meal.id);
    assert.equal(Care.currentMeal(local(meal.end - 1, 59, 28, 59, 999)).id, meal.id);
    assert.equal(Care.currentMeal(local(meal.end)), null);
  }
});
test('저장 날짜는 UTC가 아닌 기기 현지 날짜', () => {
  const now = new Date('2026-10-27T23:30:00.000Z');
  assert.equal(Care.dateKey(now), '2026-10-28');
  assert.equal(Care.currentMeal(now).id, 'breakfast');
});
test('식사 시간 외에는 기록과 보상을 지급하지 않음', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  for (const hour of [6, 10, 11, 15, 16, 20, 23]) {
    env.setTime(local(hour));
    const result = await env.repo.feed();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'outside-window');
  }
  assert.equal([...env.storage.items.keys()].filter(key => key.endsWith(':completed')).length, 0);
});
test('연속 20번 클릭해도 한 끼 보상은 한 번, 기록은 즉시 완료', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(7));
  const results = await Promise.all(Array.from({ length: 20 }, () => env.repo.feed()));
  assert.equal(results.filter(result => result.ok).length, 1);
  const state = results[0].state;
  assert.deepEqual(state.stats, { affection: 68, fullness: 100 });
  assert.equal(state.meals[0].status, 'eaten');
  assert.equal(state.meals[0].stateLabel, '먹었어요');
  assert.equal(state.meals[0].available, false);
  assert.equal(state.history['2026-10-28'].breakfast.type, 'completed');
});
test('아침·점심·저녁은 각각 한 번씩 먹일 수 있음', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  for (const [hour, mealId] of [[7, 'breakfast'], [13, 'lunch'], [18, 'dinner']]) {
    env.setTime(local(hour));
    assert.equal((await env.repo.feed()).meal.id, mealId);
    assert.equal((await env.repo.feed()).reason, 'already-eaten');
  }
  const state = env.repo.snapshot();
  assert.deepEqual(state.stats, { affection: 74, fullness: 100 });
  assert(state.meals.every(meal => meal.status === 'eaten'));
});
test('종료 전에는 아직 / 정확히 종료 시 놓침, 감소는 재조회해도 한 번', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(new Date(2026, 9, 28, 9, 59, 59, 999));
  assert.equal(env.repo.snapshot().meals[0].status, 'pending');
  env.setTime(local(10));
  let state = env.repo.snapshot();
  assert.equal(state.meals[0].status, 'missed');
  assert.equal(state.meals[1].status, 'pending');
  assert.equal(state.stats.fullness, 70);
  for (let i = 0; i < 10; i++) assert.equal(env.repo.snapshot().stats.fullness, 70);
  env.setTime(local(15));
  state = env.repo.snapshot();
  assert.equal(state.meals[1].status, 'missed');
  assert.equal(state.meals[2].status, 'pending');
  env.setTime(local(20));
  assert(env.repo.snapshot().meals.every(meal => meal.status === 'missed'));
});
test('새 저장소 인스턴스(재실행)에서도 기록과 수치 복원', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(7, 30));
  await env.repo.feed();
  const reopened = Care.repository(env.storage, env.options);
  assert.deepEqual(reopened.snapshot().stats, { affection: 68, fullness: 100 });
  assert.deepEqual(reopened.loadProfile().profile, profile);
  assert.equal((await reopened.feed()).reason, 'already-eaten');
  await reopened.saveProfile({ name: '하늘', gender: 'male' });
  assert.deepEqual(reopened.snapshot().stats, { affection: 68, fullness: 100 });
  assert.equal(reopened.snapshot().meals[0].status, 'eaten');
});
test('자정에는 새 날짜 표시, 이전 기록 보존, 다음 날 새 식사 가능', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  for (const hour of [7, 13, 18]) { env.setTime(local(hour)); await env.repo.feed(); }
  env.setTime(local(0, 0, 29));
  const midnight = env.repo.snapshot();
  assert.equal(midnight.date, '2026-10-29');
  assert(midnight.meals.every(meal => meal.status === 'pending'));
  assert.equal(Object.values(midnight.history['2026-10-28']).filter(item => item.type === 'completed').length, 3);
  env.setTime(local(7, 0, 29));
  assert.equal((await env.repo.feed()).ok, true);
  assert.equal(env.repo.snapshot().stats.affection, 77);
  assert.equal(env.repo.snapshot().history['2026-10-28'].breakfast.type, 'completed');
});
test('가입 전 종료된 식사는 포만도 벌점 없음', async () => {
  const env = setup(local(17));
  await env.repo.saveProfile(profile);
  assert.equal(env.repo.snapshot().stats.fullness, 80);
  assert.equal(env.repo.snapshot().meals[0].status, 'missed');
  env.setTime(local(20));
  assert.equal(env.repo.snapshot().stats.fullness, 70);
});
test('장기 미접속 감소는 작게 제한되고 다시 돌보면 회복', async () => {
  const env = setup(local(0));
  await env.repo.saveProfile(profile);
  env.setTime(local(6, 0, 40));
  const unattended = env.repo.snapshot();
  assert.deepEqual(unattended.stats, { affection: 62, fullness: 0 });
  assert.equal(env.repo.snapshot().stats.affection, 62);
  env.setTime(local(7, 0, 40));
  const fed = await env.repo.feed();
  assert.deepEqual(fed.state.stats, { affection: 65, fullness: 20 });
  assert.equal(Care.getFullness(fed.state.stats.fullness).stage.label, '배고파요');
});
test('저장 실패 시 완료나 보상을 허위 지급하지 않음', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(7));
  env.storage.failWrites = true;
  await assert.rejects(() => env.repo.feed(), /Quota/);
  env.storage.failWrites = false;
  assert.deepEqual(env.repo.snapshot().stats, { affection: 65, fullness: 80 });
  assert.equal(env.repo.snapshot().meals[0].status, 'pending');
});
test('대기하던 탭이 식사 종료 후 잠금을 얻으면 식사 거절', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(8, 59));
  const waiting = Care.repository(env.storage, { ...env.options, withLock: async task => { env.setTime(local(10)); return task(); } });
  assert.equal((await waiting.feed()).reason, 'outside-window');
  assert.equal([...env.storage.items.keys()].filter(key => key.endsWith(':completed')).length, 0);
});
test('여러 탭이 동일 잠금을 공유하면 한 번만 완료', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(13));
  let queue = Promise.resolve();
  const lock = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const tabA = Care.repository(env.storage, { ...env.options, withLock: lock });
  const tabB = Care.repository(env.storage, { ...env.options, withLock: lock });
  const results = await Promise.all([tabA.feed(), tabB.feed(), tabA.feed(), tabB.feed()]);
  assert.equal(results.filter(item => item.ok).length, 1);
  assert.equal(tabA.snapshot().stats.affection, 68);
  assert.equal(tabB.snapshot().stats.affection, 68);
});
test('같은 식사 키가 두 번 저장되어도 보상은 기록 하나로 계산', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(7));
  await env.repo.feed();
  const key = [...env.storage.items.keys()].find(key => key.endsWith(':completed'));
  const event = JSON.parse(env.storage.getItem(key));
  event.at = local(7, 1).toISOString();
  env.storage.setItem(key, JSON.stringify(event));
  assert.deepEqual(env.repo.snapshot().stats, { affection: 68, fullness: 100 });
});
test('종료 경계에서 놓침 기록과 완료가 함께 생겨도 완료 우선', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(8, 59));
  await env.repo.feed();
  env.storage.setItem(Care.PREFIX + 'main:2026-10-28:breakfast:missed', JSON.stringify({ type: 'missed', date: '2026-10-28', mealId: 'breakfast', at: local(9).toISOString(), offset: -540 }));
  env.setTime(local(9));
  assert.deepEqual(env.repo.snapshot().stats, { affection: 68, fullness: 100 });
  assert.equal(env.repo.snapshot().meals[0].status, 'eaten');
});
test('저장된 시간대가 바뀌어도 원래 현지 식사 기록 검증 가능', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(8, 30));
  await env.repo.feed();
  try {
    process.env.TZ = 'UTC';
    const state = env.repo.snapshot();
    assert.equal(state.history['2026-10-28'].breakfast.type, 'completed');
    assert.equal(state.stats.affection, 68);
  } finally { process.env.TZ = 'Asia/Seoul'; }
});
test('손상된 기록과 시간대 외 저장은 덮어쓰지 않고 중단', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  const key = Care.PREFIX + 'main:2026-10-28:breakfast:completed';
  env.storage.setItem(key, '{broken');
  assert.throws(() => env.repo.snapshot(), /기록/);
  assert.equal(env.storage.getItem(key), '{broken');
  env.storage.setItem(key, JSON.stringify({ type: 'completed', date: '2026-10-28', mealId: 'breakfast', at: local(10).toISOString(), offset: -540 }));
  assert.throws(() => env.repo.snapshot(), /날짜나 시간/);
});
test('프로필 없는 미리보기에서는 저장과 식사 지급 안 함', async () => {
  const env = setup(local(7));
  assert.equal(env.repo.snapshot(), null);
  assert.equal((await env.repo.feed()).reason, 'no-profile');
  assert.equal(env.storage.length, 0);
});

test('테스트 초기화는 초기 돌봄 수치를 복원하고 강아지 정보를 보존', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  for (const hour of [7, 13, 18]) { env.setTime(local(hour)); await env.repo.feed(); }
  env.setTime(local(7, 0, 29));
  const before = env.repo.snapshot().stats;
  await env.repo.feed();
  const reset = await env.repo.resetCareForTesting();
  assert.notDeepEqual(reset.stats, before);
  assert.deepEqual(reset.stats, { affection: 10, fullness: 70 });
  assert.deepEqual(reset.profile, profile);
  assert.equal(reset.meals[0].status, 'pending');
  assert.equal(reset.meals[0].available, true);
  assert.equal(reset.history['2026-10-28'], undefined);
  assert.equal((await env.repo.feed()).ok, true);
  assert.equal((await env.repo.feed()).reason, 'already-eaten');
});

test('테스트 초기화로 식사 시간 제한을 우회하지 않음', async () => {
  const env = setup();
  await env.repo.saveProfile(profile);
  env.setTime(local(7));
  await env.repo.feed();
  env.setTime(local(10));
  const state = await env.repo.resetCareForTesting();
  assert.equal(state.meals[0].status, 'missed');
  assert.equal((await env.repo.feed()).reason, 'outside-window');
  assert.deepEqual(state.stats, { affection: 10, fullness: 70 });
});
