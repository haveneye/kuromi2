// UI integration without a browser: exercise the actual app.js against HTML-backed DOM stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
process.env.TZ = 'Asia/Seoul';
const ModernCare = require('../game-state.js');
// Preserve the legacy UI fixture; current care rules and screens have dedicated v2 coverage.
const Care = {...ModernCare, repository:(storage,options={})=>ModernCare.repository(storage,{rulesVersion:1,...options})};
const Toys = require('../toy-state.js');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  removeItem(key) { this.data.delete(key); }
  setItem(key, value) { this.data.set(key, String(value)); }
}
function ui(storage, getNow, options = {}) {
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let elapsed = 0;
  function element(name) {
    if (!elements.has(name)) {
      const classes = new Set(name === '#home-screen' ? ['hidden'] : []);
      elements.set(name, {
        value: '', textContent: '', hidden: false, disabled: false, open: false, complete: true, naturalWidth: 100, dataset: {}, attrs: {}, events: {},
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
        style: { setProperty(key, value) { this[key] = value; } },
        addEventListener(type, handler) { this.events[type] = handler; },
        setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'hidden') this.hidden = true; },
        removeAttribute(key) { delete this.attrs[key]; if (key === 'hidden') this.hidden = false; },
        focus() {}, scrollIntoView() {}, closest(selector) { return element('#ancestor-' + selector.replace(/[^a-z0-9-]/gi, '')); }, setCustomValidity() {}, reportValidity() { return true; },
        showModal() { this.open = true; }, close() { this.open = false; },
        querySelector(selector) { return element(name + ' ' + selector); }
      });
    }
    return elements.get(name);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'HTML IDs must be unique');
  const actions = [...html.matchAll(/data-action="([^"]+)"/g)].map(match => {
    const button = element('[data-action="' + match[1] + '"]');
    button.dataset.action = match[1];
    return button;
  });
  const windowEvents = {};
  const documentEvents = {};
  const deviceLocation = { search: options.search || '', pathname: '/index.html', hash: '' };
  const replacedAddresses = [];
  class DeviceDate extends Date {
    constructor(...args) { super(...(args.length ? args : [getNow().getTime()])); }
  }
  const context = vm.createContext({
    PuppyToys: Toys,
    PuppyCare: { ...Care, repository: (storage, repoOptions) => (options.modern ? ModernCare : Care).repository(storage, { ...repoOptions, now: getNow, random: options.random }) },
    document: {
      hidden: false,
      querySelector(selector) {
        if (selector.startsWith('#')) assert(ids.includes(selector.slice(1).split(/\s+/)[0]), 'Missing HTML element ' + selector);
        return element(selector);
      },
      querySelectorAll: () => actions,
      addEventListener(type, handler) { documentEvents[type] = handler; }
    },
    window: { localStorage: storage, scrollTo() {}, addEventListener(type, handler) { windowEvents[type] = handler; } },
    navigator: options.noLocks ? {} : { locks: { request(name, config, task) { return task(); } } }, Date: DeviceDate, Intl, URLSearchParams, location: deviceLocation,
    history: { replaceState(state, title, address) { replacedAddresses.push(address); deviceLocation.search = address.includes('?') ? '?' + address.split('?')[1].split('#')[0] : ''; } },
    FormData: class { get() { return 'female'; } },
    setInterval() { return 1; },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: elapsed + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console: { error(...args) { throw new Error('Unexpected UI error: ' + args.join(' ')); } }
  });
  vm.runInContext(source, context);
  if (options.modern) vm.runInContext(fs.readFileSync(require.resolve('../activity-ui.js'), 'utf8'), context);
  if (options.toys) vm.runInContext(fs.readFileSync(require.resolve('../toys-ui.js'), 'utf8'), context);
  return {
    element, run: code => vm.runInContext(code, context), windowEvents, documentEvents, replacedAddresses,
    advanceTimers(ms) {
      elapsed += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); }
    }
  };
}
const local = (hour, minute = 0, day = 28) => new Date(2026, 9, day, hour, minute);

test('v2 UI: 초기값·훈련 잠금, 인벤토리 간식으로 친밀도 해금, 훈련 3회와 복원', async()=>{
  const storage=new Storage();let now=local(7);
  await ModernCare.repository(storage,{now:()=>now}).saveProfile({name:'연탄',gender:'female'});
  storage.setItem(Care.SNACK_KEY,JSON.stringify({schemaVersion:1,openingBalance:500,transactions:[]}));
  const app=ui(storage,()=>now,{modern:true,random:()=>0});
  assert.equal(app.element('#bond-score').textContent,10);
  assert.equal(app.element('#fullness-score').textContent,'70/100');
  assert.equal(app.element('#mood-label').textContent,'낯설어함');
  assert.equal(app.element('#train-sit').disabled,true);
  assert.equal(app.element('#puppy-bond-friend').hidden,true);
  for(let i=0;i<3;i++)await app.run('handleSnack("buy","meat")');
  app.run('openSnacks("inventory")');
  assert.equal(app.element('#give-snack-meat').hidden,false);
  assert.equal(app.element('#snack-limit-rule').hidden,false);
  for(let i=0;i<3;i++)await app.run('handleSnack("give","meat")');
  app.advanceTimers(4000);
  assert.equal(app.element('#bond-score').textContent,37);
  assert.equal(app.element('#train-sit').disabled,false);
  app.element('[data-action="훈련"]').events.click();
  assert.equal(app.element('#activity-dialog').open,true);
  assert.equal(app.element('#train-paw').disabled,true);
  await app.element('#train-sit').events.click();
  assert.equal(app.element('#mastery-sit').value,10);
  assert(app.element('#activity-message').textContent.includes('훈련 성공'));
  await app.element('#train-sit').events.click();
  await app.element('#train-sit').events.click();
  assert(app.element('#training-summary-text').textContent.includes('3/3'));
  assert.equal(app.element('#train-sit').disabled,true);
  assert.equal(app.element('#fullness-score').textContent,'91/100');
  const reopened=ui(storage,()=>now,{modern:true});
  assert.equal(reopened.element('#mastery-sit').value,30);
  assert.equal(reopened.element('#train-sit').disabled,true);
  now=local(7,0,29);reopened.run('updateClock()');
  assert(reopened.element('#training-summary-text').textContent.includes('0/3'));
  assert.equal(reopened.element('#mastery-sit').value,30);
});

test('v2 UI: 실패 결과·포만감 비용, 산책 기록 버튼 및 이미지 로딩 대체',async()=>{
  const storage=new Storage();const now=local(7);
  const legacy=Care.repository(storage,{now:()=>now});await legacy.saveProfile({name:'연탄',gender:'female'});
  const app=ui(storage,()=>now,{modern:true,random:()=>.99});
  await app.element('#train-sit').events.click();
  assert(app.element('#activity-message').textContent.includes('실패'));
  assert.equal(app.element('#mastery-sit').value,0);
  assert.equal(app.element('#fullness-score').textContent,'77/100');
  app.element('[data-action="산책"]').events.click();
  assert.equal(app.element('#activity-title').textContent,'오늘의 산책');
  await app.element('#complete-walk').events.click();
  assert.equal(app.element('#complete-walk').disabled,true);
  assert.equal(app.element('#fullness-score').textContent,'67/100');
  app.element('#bond-sheet').naturalWidth=0;
  app.element('#bond-sheet').events.error();
  assert.equal(app.element('#puppy-bond').hidden,true);
  assert.equal(app.element('#puppy-idle').hidden,true);
  assert.equal(app.element('#puppy-sad').hidden,false,'배고픔 상태가 활성화되어 있어 슬픈 그림을 유지해야 함');
});

test('v2 UI: 새 사진은 친밀도 20~39에만 표시, 특별 장면과 로딩 실패 시 기존 경로 유지',async()=>{
  const storage=new Storage();let now=local(7);
  await ModernCare.repository(storage,{now:()=>now}).saveProfile({name:'연탄',gender:'female'});
  const app=ui(storage,()=>now,{modern:true});
  for(const [affection,expected] of [[19,true],[20,false],[39,false],[40,true]]) {
    app.run(`gameState.stats.affection=${affection};renderPuppyEmotion()`);
    assert.equal(app.element('#puppy-bond-friend').hidden,expected);
  }
  app.run('gameState.stats.affection=30;renderPuppyEmotion()');
  app.element('#puppy-bond-friend').naturalWidth=0;
  app.element('#puppy-bond-friend').events.error();
  assert.equal(app.element('#puppy-bond-friend').hidden,true);
  assert.equal(app.element('#puppy-bond').hidden,false);
  app.element('#puppy-bond-friend').naturalWidth=1341;
  app.element('#puppy-bond-friend').events.load();
  assert.equal(app.element('#puppy-bond-friend').hidden,false);
  app.run('showMealSpeech()');
  assert.equal(app.element('#puppy-bond-friend').hidden,true);
  assert.equal(app.element('#puppy-happy').hidden,false);
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-bond-friend').hidden,false);
  app.run('gameState.waitingForFood=true;renderPuppyEmotion()');
  assert.equal(app.element('#puppy-bond-friend').hidden,true);
  assert.equal(app.element('#puppy-sad').hidden,false);
  now=local(22);app.run('renderPuppyEmotion()');
  assert.equal(app.element('#puppy-bond-friend').hidden,true);
  assert.equal(app.element('#puppy-sleep').hidden,false);
});

test('v2 UI: 친밀도 구간별 상태와 말풍선 문구가 경계 점수에서 변경',async()=>{
  const storage=new Storage(),now=local(10);
  await ModernCare.repository(storage,{now:()=>now}).saveProfile({name:'연탄',gender:'female'});
  const app=ui(storage,()=>now,{modern:true});
  const cases=[[0,'낯설어함','낑....'],[19,'낯설어함','낑....'],[20,'조금씩 마음을 열음','안녕....'],[39,'조금씩 마음을 열음','안녕....'],[40,'주인을 신뢰하기 시작','마리야 안녕^^'],[59,'주인을 신뢰하기 시작','마리야 안녕^^'],[60,'주인과 친해짐','마리야 놀아줘~'],[79,'주인과 친해짐','마리야 놀아줘~'],[80,'아주 좋아함','헤헤 기분좋아'],[100,'아주 좋아함','헤헤 기분좋아']];
  for(const [score,label,speech] of cases){
    app.run(`gameState.stats.affection=${score};renderPet(gameState,new Date())`);
    assert.equal(app.element('#mood-label').textContent,label);
    assert.equal(app.element('#puppy-speech').textContent,speech);
  }
  app.run('showMealSpeech()');
  assert.equal(app.element('#puppy-speech').textContent,'마리야 고마워, 냠냠');
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-speech').textContent,'헤헤 기분좋아');
});

test('UI: 주소로 제출된 연탄 이름을 저장하고 기존 식사·간식 기록 보존, 재접속 복원', async () => {
  const storage = new Storage();
  const now = local(7);
  const repo = Care.repository(storage, { now: () => now });
  await repo.saveProfile({ name: '루시', gender: 'male' });
  await repo.feed();
  await repo.buySnack('milk', 'name-test-buy');
  const before = repo.snapshot();
  const app = ui(storage, () => now, { search: '?name=%EC%97%B0%ED%83%84&gender=female&other=keep' });
  await app.run('initialization');
  assert.equal(app.element('#pet-name').textContent, '연탄');
  assert.equal(app.element('#pet-gender').textContent, '♀');
  assert.deepEqual(app.replacedAddresses, ['/index.html?other=keep']);
  const saved = repo.snapshot();
  assert.deepEqual(saved.profile, { name: '연탄', gender: 'female' });
  assert.deepEqual(saved.history, before.history);
  assert.deepEqual(saved.snacks, before.snacks);
  assert.equal(saved.createdAt, before.createdAt);
  assert.equal(ui(storage, () => now).element('#pet-name').textContent, '연탄');
  app.element('#puppy-name').value = '새이름';
  await app.element('#start-form').events.submit({ preventDefault() {} });
  assert.equal(ui(storage, () => now).element('#pet-name').textContent, '새이름');
});

test('UI: 잘못된 주소 프로필은 기존 저장 이름을 바꾸지 않음', async () => {
  const storage = new Storage();
  const now = local(7);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '연탄', gender: 'female' });
  for (const search of ['?name=루시', '?name=루시&gender=unknown', '?name=%20%20&gender=male']) {
    const app = ui(storage, () => now, { search });
    await app.run('initialization');
    assert.equal(app.element('#pet-name').textContent, '연탄');
    assert.equal(app.replacedAddresses.length, 0);
  }
});

test('UI: 끼니를 놓치면 첨부 그림, 구매로는 유지, 간식 급여 후 기본 모습과 재실행 복원', async () => {
  const storage = new Storage();
  let now = local(6);
  const repo = Care.repository(storage, { now: () => now });
  await repo.saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => now);
  assert.equal(app.element('#puppy-sad').hidden, true);
  now = local(10); app.run('updateClock()');
  assert.equal(app.run('gameState.waitingForFood'), true);
  assert.equal(app.element('#puppy-sad').hidden, false);
  assert.equal(app.element('#puppy-idle').hidden, true);
  assert.equal(ui(storage, () => now).element('#puppy-sad').hidden, false);
  await app.run('feedMeal()'); // outside the meal window is not successful feeding
  assert.equal(app.element('#puppy-sad').hidden, false);
  await app.run("handleSnack('buy', 'milk')");
  assert.equal(app.element('#puppy-sad').hidden, false);
  await app.run("handleSnack('give', 'milk')");
  assert.equal(app.element('#puppy-sad').hidden, true);
  assert.equal(app.element('#puppy-happy').hidden, false);
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-idle').hidden, false);
  assert.equal(ui(storage, () => now).element('#puppy-sad').hidden, true);
  now = local(15); app.run('updateClock()');
  assert.equal(app.element('#puppy-sad').hidden, false);
  now = local(18); await app.run('feedMeal()');
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-sad').hidden, true);
  assert.equal(app.element('#puppy-idle').hidden, false);
  assert.equal(ui(storage, () => now).element('#puppy-sad').hidden, true);
});

test('UI: 슬픈 상태는 자정에도 보관하고 수면 시간에는 잠자는 그림 우선', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(20);
  const app = ui(storage, () => now);
  assert.equal(app.element('#puppy-sad').hidden, false);
  now = local(22); app.run('updateClock()');
  assert.equal(app.element('#puppy-sad').hidden, true);
  assert.equal(app.element('#puppy-sleep').hidden, false);
  now = local(7, 0, 29); app.run('updateClock()');
  assert.equal(app.element('#puppy-sad').hidden, false);
  await app.run('feedMeal()'); app.advanceTimers(4000);
  assert.equal(app.element('#puppy-sad').hidden, true);
  assert.equal(app.element('#puppy-idle').hidden, false);
});

test('UI: 슬픈 그림 로딩 실패 시 기본 강아지 유지, 로드 완료 후 다시 표시', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => now);
  app.element('#puppy-sad').naturalWidth = 0;
  now = local(10); app.run('updateClock()');
  app.element('#puppy-sad').events.error();
  assert.equal(app.element('#puppy-sad').hidden, true);
  assert.equal(app.element('#puppy-idle').hidden, false);
  app.element('#puppy-sad').naturalWidth = 1536;
  app.element('#puppy-sad').events.load();
  assert.equal(app.element('#puppy-sad').hidden, false);
  assert.equal(app.element('#puppy-idle').hidden, true);
});

test('UI: 먹이기 직후 수치·카드 갱신, 중복 클릭 차단, 재실행 복원', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7);
  const app = ui(storage, () => new Date(now));
  assert.equal(app.element('#pet-name').textContent, '구름');
  assert.equal(app.element('#home-screen').classList.contains('hidden'), false);
  assert(app.element('#meal-hint').textContent.includes('아침 시간'));
  assert.equal(app.element('#hunger-label').textContent, '배불러요');
  await Promise.all([app.run('feedMeal()'), app.run('feedMeal()'), app.run('feedMeal()')]);
  assert.equal(app.element('#reset-today-meals').disabled, false, '먹이기 처리 후 초기화 버튼이 다시 활성화되어야 함');
  assert.equal(app.element('#bond-score').textContent, 68);
  assert.equal(app.element('#fullness-score').textContent, '100/100');
  assert.equal(app.element('#meal-breakfast .meal-state').textContent, '먹었어요 ✅');
  assert.equal(app.element('#meal-breakfast').dataset.status, 'eaten');
  assert.equal(app.element('#cash-balance').textContent, '120');
  const reopened = ui(storage, () => new Date(now));
  assert.equal(reopened.element('#meal-breakfast .meal-state').textContent, '먹었어요 ✅');
  assert.equal(reopened.element('#bond-score').textContent, 68);
});
test('UI: 종료 시각과 자정에서 카드가 자동으로 갱신', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  assert.equal(app.element('#meal-breakfast').dataset.status, 'pending');
  now = local(10);
  app.run('updateClock()');
  assert.equal(app.element('#meal-breakfast .meal-state').textContent, '놓쳤어요 😢');
  assert.equal(app.element('#fullness-score').textContent, '70/100');
  now = local(0, 0, 29);
  app.run('updateClock()');
  for (const id of ['breakfast', 'lunch', 'dinner']) assert.equal(app.element('#meal-' + id).dataset.status, 'pending');
  assert.equal(Care.repository(storage, { now: () => now }).snapshot().history['2026-10-28'].breakfast.type, 'missed');
});

test('UI: 식사 성공 대사는 4초 후 복귀하고 중복 식사는 대사를 연장하지 않음', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7);
  const app = ui(storage, () => new Date(now));
  await app.run('feedMeal()');
  assert.equal(app.element('#puppy-speech').textContent, '마리야 고마워, 냠냠');
  assert.equal(app.element('#puppy-action-frame').dataset.scene, 'meal');
  assert.equal(app.element('#puppy-happy').hidden, false);
  assert.equal(app.element('#puppy-idle').hidden, true);
  app.advanceTimers(2000);
  await app.run('feedMeal()');
  app.advanceTimers(1999);
  assert.equal(app.element('#puppy-speech').textContent, '마리야 고마워, 냠냠');
  app.advanceTimers(1);
  assert.equal(app.element('#puppy-speech').textContent, '나랑 놀아줘');
  assert.equal(app.element('#puppy-happy').hidden, true);
  assert.equal(app.element('#puppy-idle').hidden, false);
  now = local(10);
  await app.run('feedMeal()');
  assert.equal(app.element('#puppy-speech').textContent, '나랑 놀아줘');
  assert.equal(app.element('#puppy-happy').hidden, true);
});

test('UI: 테스트 초기화 버튼으로 오늘 식사를 다시 먹일 수 있음', async () => {
  const storage = new Storage();
  let now = local(6);
  await ModernCare.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7);
  const app = ui(storage, () => new Date(now), { modern: true });
  await app.run('feedMeal()');
  assert.equal(app.element('#reset-today-meals').disabled, false, '초기화 클릭 전에 실제 버튼이 활성화되어야 함');
  await app.element('#reset-today-meals').events.click();
  assert.equal(app.element('#bond-score').textContent, 10);
  assert.equal(app.element('#fullness-score').textContent, '70/100');
  assert.equal(app.element('#meal-breakfast').dataset.status, 'pending');
  assert.equal(app.element('#puppy-speech').textContent, '낑....');
  assert.equal(app.element('#puppy-happy').hidden, true);
  assert.equal(app.element('#puppy-bond').hidden, false);
  await app.run('feedMeal()');
  assert.equal(app.element('#bond-score').textContent, 11);
  assert.equal(app.element('#meal-breakfast').dataset.status, 'eaten');
});

test('UI: 기쁨 이미지 로딩 실패 시 기존 캐릭터를 유지하고 로딩 후 표시', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7);
  const app = ui(storage, () => new Date(now));
  app.element('#puppy-happy').naturalWidth = 0;
  await app.run('feedMeal()');
  assert.equal(app.element('#puppy-happy').hidden, true);
  assert.equal(app.element('#puppy-idle').hidden, false);
  app.element('#puppy-happy').naturalWidth = 100;
  app.element('#puppy-happy').events.load();
  assert.equal(app.element('#puppy-happy').hidden, false);
  assert.equal(app.element('#puppy-idle').hidden, true);
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-idle').hidden, false);
});

test('UI: 시계 갱신이 기쁨 상태를 조기 종료하지 않음', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7, 59);
  const app = ui(storage, () => new Date(now));
  await app.run('feedMeal()');
  now = local(8);
  app.run('updateClock()');
  assert.equal(app.element('#puppy-happy').hidden, false);
  assert.equal(app.element('#puppy-idle').hidden, true);
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-idle').hidden, false);
});

test('UI: 간식·상점·인벤토리 열기, 구매와 급여, 기쁨 반응, 재실행 복원', async () => {
  const storage = new Storage();
  const now = local(7);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  app.element('[data-action="상점"]').events.click();
  assert.equal(app.element('#snack-dialog').open, true);
  assert.equal(app.element('#snack-title').textContent, '간식 상점');
  assert.equal(app.element('#buy-snack-milk').hidden, false);
  await app.run('handleSnack("buy", "milk")');
  assert.equal(app.element('#snack-stock-milk').textContent, 1);
  assert.equal(app.element('#cash-balance').textContent, '90');
  assert.equal(app.element('#bond-score').textContent, 65);
  assert.equal(app.element('#snack-daily-count').textContent, '오늘 0/3개');
  assert.equal(app.element('#buy-snack-milk').disabled, false);
  app.element('[data-action="인벤토리"]').events.click();
  assert.equal(app.element('#snack-title').textContent, '인벤토리');
  assert.equal(app.element('#buy-snack-milk').hidden, true);
  assert.equal(app.element('#give-snack-milk').hidden, false);
  app.element('[data-action="간식"]').events.click();
  assert.equal(app.element('#give-snack-milk').hidden, false);
  await app.run('handleSnack("give", "milk")');
  assert.equal(app.element('#snack-dialog').open, false);
  assert.equal(app.element('#snack-stock-milk').textContent, 0);
  assert.equal(app.element('#snack-menu-count').textContent, '1/3');
  assert.equal(app.element('#bond-score').textContent, 67);
  assert.equal(app.element('#fullness-score').textContent, '85/100');
  assert.equal(app.element('#puppy-happy').hidden, false);
  assert.equal(app.element('#puppy-speech').textContent, '마리야 간식 고마워! 🥰');
  assert.equal(app.element('#puppy-action-frame').dataset.scene, 'snack');
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-idle').hidden, false);
  assert.equal(app.element('#puppy-sleep').hidden, true);
  assert.equal(app.element('#puppy-speech').textContent, '나랑 놀아줘');
  const reopened = ui(storage, () => new Date(now));
  assert.equal(reopened.element('#snack-menu-count').textContent, '1/3');
  assert.equal(reopened.element('#cash-balance').textContent, '90');
  assert.equal(reopened.element('#snack-stock-milk').textContent, 0);
});

test('UI: 3개 급여 후 모든 급여 버튼 비활성, 상점 구매는 계속 가능', async () => {
  const storage = new Storage();
  const now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  for (let i = 0; i < 3; i++) await app.run('handleSnack("buy", "milk")');
  for (let i = 0; i < 3; i++) await app.run('handleSnack("give", "milk")');
  assert.equal(app.element('#snack-daily-count').textContent, '오늘 3/3개');
  assert.equal(app.element('#snack-remaining').textContent, '오늘 간식은 다 먹었어요! 내일 다시 주세요 🐶');
  for (const snack of Care.SNACKS) assert.equal(app.element('#give-snack-' + snack.id).disabled, true);
  app.run('openSnacks("shop")');
  assert.equal(app.element('#buy-snack-milk').disabled, false);
  await app.run('handleSnack("buy", "milk")');
  assert.equal(app.element('#snack-stock-milk').textContent, 1);
  assert.equal(app.element('#snack-menu-count').textContent, '3/3');
  assert.equal(app.element('#give-snack-milk').disabled, true);
});

test('UI: 간식 버튼 연타 시 한 요청만 처리하고 버튼을 복원', async () => {
  const storage = new Storage();
  const now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  await app.run('handleSnack("buy", "milk")');
  await app.run('handleSnack("buy", "milk")');
  await Promise.all(Array.from({ length: 10 }, () => app.run('handleSnack("give", "milk")')));
  assert.equal(app.element('#snack-menu-count').textContent, '1/3');
  assert.equal(app.element('#snack-stock-milk').textContent, 1);
  assert.equal(app.element('#give-snack-milk').disabled, false);
});

test('UI: 자정 이후 간식 창과 메인 횟수 모두 초기화, 재고 유지', async () => {
  const storage = new Storage();
  let now = local(6);
  const repo = Care.repository(storage, { now: () => now });
  await repo.saveProfile({ name: '구름', gender: 'female' });
  for (let i = 0; i < 4; i++) await repo.buySnack('milk', 'buy-' + i);
  for (let i = 0; i < 3; i++) await repo.giveSnack('milk', 'give-' + i);
  const app = ui(storage, () => new Date(now));
  app.run('openSnacks()');
  now = local(0, 0, 29);
  app.run('updateClock()');
  assert.equal(app.element('#snack-daily-count').textContent, '오늘 0/3개');
  assert.equal(app.element('#snack-menu-count').textContent, '0/3');
  assert.equal(app.element('#snack-stock-milk').textContent, 1);
  assert.equal(app.element('#give-snack-milk').disabled, false);
});

test('UI: 안전한 잠금 미지원 시 간식 거래 비활성, 기존 식사는 동작', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  now = local(7);
  const app = ui(storage, () => new Date(now), { noLocks: true });
  app.run('openSnacks("shop")');
  assert.equal(app.element('#buy-snack-milk').disabled, true);
  assert(app.element('#snack-message').textContent.includes('지원하지'));
  await app.run('feedMeal()');
  assert.equal(app.element('#bond-score').textContent, 68);
});

test('UI: 보유 간식 없는 급여와 미리보기는 보상·기쁨 반응 없음', async () => {
  const storage = new Storage();
  const now = local(6);
  const preview = ui(storage, () => new Date(now));
  preview.run('openSnacks("shop")');
  assert.equal(preview.element('#buy-snack-milk').disabled, true);
  assert.equal(storage.length, 0);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  await app.run('handleSnack("give", "milk")');
  assert.equal(app.element('#snack-menu-count').textContent, '0/3');
  assert.equal(app.element('#puppy-happy').hidden, true);
  assert.equal(app.element('#bond-score').textContent, 65);
});

test('UI: 상점은 상품만, 인벤토리는 실제 보유 종류와 수량만 표시', async () => {
  const storage = new Storage();
  const now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  assert.equal(html.includes('snack-tabs'), false);
  app.run('openSnacks("inventory")');
  assert.equal(app.element('#snack-cards').hidden, true);
  assert(app.element('#snack-message').textContent.includes('아직 보유한 간식이 없어요'));
  app.run('openSnacks("shop")');
  assert.equal(app.element('#snack-limit-rule').hidden, true);
  assert.equal(app.element('#snack-wallet-note').hidden, false);
  for (const snack of Care.SNACKS) {
    assert.equal(app.element('#snack-item-' + snack.id).hidden, false);
    assert.equal(app.element('#give-snack-' + snack.id).hidden, true);
    assert.equal(app.element('#buy-snack-' + snack.id).hidden, false);
    assert.equal(app.element('#snack-price-' + snack.id).hidden, false);
  }
  await app.run('handleSnack("buy", "cookie")');
  app.run('openSnacks("inventory")');
  assert.equal(app.element('#snack-cards').hidden, false);
  assert.equal(app.element('#snack-item-cookie').hidden, false);
  assert.equal(app.element('#snack-stock-cookie').textContent, 1);
  assert.equal(app.element('#snack-item-milk').hidden, true);
  assert.equal(app.element('#snack-item-meat').hidden, true);
  assert.equal(app.element('#snack-wallet-note').hidden, true);
  assert.equal(app.element('#snack-limit-rule').hidden, true);
  assert.equal(app.element('#snack-footnote').hidden, true);
  assert.equal(app.element('#snack-effects-cookie').hidden, true);
  assert.equal(app.element('#snack-price-cookie').hidden, true);
  assert.equal(app.element('#snack-message').hidden, true);
  for (const snack of Care.SNACKS) {
    assert.equal(app.element('#give-snack-' + snack.id).hidden, false);
    assert.equal(app.element('#buy-snack-' + snack.id).hidden, true);
  }
  await app.run('handleSnack("give", "cookie")');
  assert.equal(app.element('#snack-item-cookie').hidden, true);
  app.run('openSnacks("feed")');
  assert.equal(app.element('#snack-limit-rule').hidden, false);
  assert.equal(app.element('#snack-item-milk').hidden, false);
});

test('UI: 전체 초기화 버튼으로 오늘 식사·모든 간식·테스트 캐시를 함께 초기화', async () => {
  const storage = new Storage();
  let now = local(6);
  await Care.repository(storage, { now: () => now }).saveProfile({ name: '구름', gender: 'female' });
  const app = ui(storage, () => new Date(now));
  await app.run('handleSnack("buy", "milk")');
  await app.run('handleSnack("buy", "milk")');
  await app.run('handleSnack("give", "milk")');
  await app.run('handleSnack("buy", "cookie")');
  now = local(7);
  await app.run('feedMeal()');
  assert.equal(app.element('#cash-balance').textContent, '10');
  assert.equal(app.element('#snack-menu-count').textContent, '1/3');
  await app.element('#reset-today-meals').events.click();
  assert.equal(app.element('#cash-balance').textContent, '1,000');
  assert.equal(app.element('#snack-panel-cash').textContent, '1,000');
  assert.equal(app.element('#snack-menu-count').textContent, '0/3');
  for (const snack of Care.SNACKS) assert.equal(app.element('#snack-stock-' + snack.id).textContent, 0);
  assert.equal(app.element('#meal-breakfast').dataset.status, 'pending');
  assert.equal(app.element('#bond-score').textContent, 10);
  assert.equal(app.element('#fullness-score').textContent, '70/100');
  assert.equal(app.element('#pet-name').textContent, '구름');
  assert.equal(app.element('#puppy-happy').hidden, true);
  assert.equal(app.element('#reset-today-meals').disabled, false);
  assert.equal(app.element('#buy-snack-milk').disabled, false);
  const reopened = ui(storage, () => new Date(now));
  assert.equal(reopened.element('#cash-balance').textContent, '1,000');
  assert.equal(reopened.element('#snack-menu-count').textContent, '0/3');
  assert.equal(reopened.element('#meal-breakfast').dataset.status, 'pending');
});


test('UI: 미리보기에서 프로필과 식사 시간 없이 밥·간식 장면을 확인하고 저장하지 않음', async () => {
  const storage = new Storage();
  const app = ui(storage, () => local(10), { search: '?preview=1' });
  const before = [...storage.data.entries()];
  await app.run('feedMeal()');
  assert.equal(app.element('#puppy-action-frame').hidden, false);
  assert.equal(app.element('#puppy-action-frame').dataset.scene, 'meal');
  app.advanceTimers(4000);
  assert.equal(app.element('#puppy-action-frame').hidden, true);
  app.element('[data-action="간식"]').events.click();
  assert.equal(app.element('#puppy-action-frame').dataset.scene, 'snack');
  assert.equal(app.element('#puppy-action-frame').hidden, false);
  assert.deepEqual([...storage.data.entries()], before);
});


test('UI: 장난감 상점 구매→보유→놀이 완료 보상, 연타 방지와 재실행', async()=>{
  const storage=new Storage();const now=local(10);
  const app=ui(storage,()=>now,{toys:true,search:'?preview=1'});
  app.element('#open-toy-shop').events.click();
  assert.equal(app.element('#toy-dialog').open,true);
  assert.equal(app.element('#toy-balance').textContent,'5,000');
  assert.equal(app.element('#play-toy-tennis').hidden,true);
  await app.element('#buy-toy-tennis').events.click();
  assert.equal(app.element('#toy-balance').textContent,'4,900');
  assert.equal(app.element('#play-toy-tennis').hidden,false);
  app.element('[data-action="놀기"]').events.click();
  assert.equal(app.element('#toy-title').textContent,'함께 놀아요');
  app.element('#play-toy-tennis').events.click();
  app.element('#play-toy-tennis').events.click();
  assert.equal(app.element('#toy-dialog').open,false);
  assert.equal(app.element('.puppy-scene').dataset.play,'bounce');
  assert.equal(app.element('#toy-daily').textContent,'친밀도 +0/10');
  app.advanceTimers(2000);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('#toy-daily').textContent,'친밀도 +1/10');
  app.advanceTimers(2500);
  assert.equal(app.element('#play-toy-art').hidden,true);
  const reopened=ui(storage,()=>now,{toys:true,search:'?preview=1'});
  assert.equal(reopened.element('#toy-balance').textContent,'4,900');
  assert.equal(reopened.element('#toy-daily').textContent,'친밀도 +1/10');
});
test('UI: 수면 중 놀이 비활성화, 구매 가능, 보유 장난감 없는 안내',async()=>{
  const app=ui(new Storage(),()=>local(22),{toys:true});
  app.element('[data-action="인벤토리"]').events.click();
  app.element('#open-toy-inventory').events.click();
  assert.equal(app.element('#toy-empty').hidden,false);
  app.element('#toy-empty-shop').events.click();
  await app.element('#buy-toy-bone').events.click();
  assert.equal(app.element('#play-toy-bone').disabled,true);
  assert.equal(app.element('#play-toy-bone').textContent,'잠자는 중');
  assert.equal(app.element('#toy-hours').textContent,'지금은 꿈나라 · 06:00에 만나요');
});
test('UI: 놀이 도중 새로고침하면 미완료 보상을 지급하지 않음',async()=>{
  const storage=new Storage();const app=ui(storage,()=>local(10),{toys:true});
  await app.element('#buy-toy-tennis').events.click();
  app.element('#play-toy-tennis').events.click();app.advanceTimers(1000);
  const reopened=ui(storage,()=>local(10),{toys:true});
  assert.equal(reopened.element('#toy-daily').textContent,'친밀도 +0/10');
});


test('UI: 22시부터 잠자는 원본 그림, 06시부터 기본 그림으로 자동 전환',()=>{
  let now=new Date(2026,9,29,20,59,59,999);
  const app=ui(new Storage(),()=>now,{toys:true,search:'?preview=1'});
  assert.equal(app.element('#puppy-sleep').hidden,true);
  assert.equal(app.element('#puppy-idle').hidden,false);
  now=local(22);app.run('updateClock()');
  assert.equal(app.element('#puppy-sleep').hidden,false);
  assert.equal(app.element('#puppy-idle').hidden,true);
  assert.equal(app.element('#puppy-speech').textContent,'쿨쿨… 아침에 놀아요');
  now=local(0,0,30);app.run('updateClock()');
  assert.equal(app.element('#puppy-sleep').hidden,false);
  now=new Date(2026,9,30,5,59,59,999);app.run('updateClock()');
  assert.equal(app.element('#puppy-sleep').hidden,false);
  now=local(6,0,30);app.run('updateClock()');
  assert.equal(app.element('#puppy-sleep').hidden,true);
  assert.equal(app.element('#puppy-idle').hidden,false);
  assert.equal(app.element('#puppy-speech').textContent,'나랑 놀아줘');
});


test('UI: 수면 중 하단 상점·인벤토리만 활성, 아침 7시에 자동 복원',()=>{
  let now=local(20,59);
  const storage=new Storage();const app=ui(storage,()=>now,{toys:true,search:'?preview=1'});
  const careActions=['밥 주기','간식','놀기','산책','훈련'];
  const button=action=>app.element('[data-action="'+action+'"]');
  for(const action of careActions) assert.equal(!!button(action).disabled,false);
  const before=[...storage.data.entries()];
  now=local(22);app.run('updateClock()');
  for(const action of careActions){assert.equal(button(action).disabled,true);button(action).events.click();}
  assert.equal(app.element('#puppy-sleep').hidden,false);
  assert.equal(app.element('#puppy-happy').hidden,true);
  assert.equal(app.element('#snack-dialog').open,false);
  assert.equal(app.element('#toy-dialog').open,false);
  for(const action of ['상점','인벤토리']){assert.equal(!!button(action).disabled,false);button(action).events.click();assert.equal(app.element('#snack-dialog').open,true);}
  assert.equal(app.element('#snack-title').textContent,'인벤토리');
  assert.deepEqual([...storage.data.entries()],before);
  now=local(0,0,30);app.run('updateClock()');
  for(const action of careActions)assert.equal(button(action).disabled,true);
  now=local(6,0,30);app.run('updateClock()');
  for(const action of careActions)assert.equal(button(action).disabled,false);
  button('밥 주기').events.click();
  assert.equal(app.element('#puppy-happy').hidden,false);
});
