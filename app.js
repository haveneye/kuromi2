const Care = globalThis.PuppyCare;
const FORCE_WELCOME = new URLSearchParams(location.search).get('welcome') === '1';
let IS_PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
const DISPLAY_FIXTURES = Object.freeze({ mood: '신남' });
const GROWTH_VISUALS = { baby: { label: '아기 강아지', image: 'assets/black-great-dane-idle.png', scale: 1 } };
const welcome = document.querySelector('#welcome-screen');
const home = document.querySelector('#home-screen');
const form = document.querySelector('#start-form');
const nameInput = document.querySelector('#puppy-name');
const feedButton = document.querySelector('[data-action="밥 주기"]');
const resetMealsButton = document.querySelector('#reset-today-meals');
const snackDialog = document.querySelector('#snack-dialog');
const submitButton = form.querySelector('[type="submit"]');
const DEFAULT_NOTICE = '캐시·기분은 테스트 · 식사 기록은 이 기기에 저장';
let careRepo;
let gameState = null;
let pet = null;
let storageError = '';
let feeding = false;
let saving = false;
let noticeTimer;
let speechTimer;
let temporarySpeech = '';
let lastMinute = '';
let puppyEmotion = 'idle';
let hungerGreetingActive = false;
let hungerGreetingHandled = false;
let hungerGreetingTimer;
const BOND_MESSAGES = Object.freeze([
  { min: 0, label: '낯설어함', speech: '낑....' },
  { min: 20, label: '조금씩 마음을 열음', speech: '안녕....' },
  { min: 40, label: '주인을 신뢰하기 시작', speech: '마리야 안녕^^' },
  { min: 60, label: '주인과 친해짐', speech: '마리야 놀아줘~' },
  { min: 80, label: '아주 좋아함', speech: '헤헤 기분좋아' }
]);
let snackView = 'feed';
let snackBusy = false;
let snackPanelMessage = '';
let supportsSnackWrites = false;
let sharedWalletState = { connected: false, learner: '', balance: null };

function getWalletState() {
  return globalThis.PuppyWallet?.snapshot?.() || sharedWalletState;
}
function displayedCash(state) {
  const wallet = getWalletState();
  return wallet.connected ? wallet.balance : state?.snacks?.testBalance ?? Care.DEMO_CASH;
}
function renderWallet(state = gameState) {
  const wallet = getWalletState();
  const amount = displayedCash(state);
  const label = wallet.connected ? '학습앱' : '테스트';
  document.querySelector('#cash-balance').textContent = Number.isSafeInteger(amount) ? amount.toLocaleString('ko-KR') : '—';
  document.querySelector('#cash-balance-label').textContent = label;
  document.querySelector('#cash-balance').closest('.currency-card').setAttribute('aria-label', wallet.connected ? wallet.learner + ' 프로필 학습캐시 잔액' : '학습캐시 테스트 잔액');
  document.querySelector('#wallet-link-button').textContent = wallet.connected ? '연결됨' : '연결';
  document.querySelector('#wallet-link-button').setAttribute('aria-label', wallet.connected ? wallet.learner + ' 학습캐시 연결 설정' : '학습 앱 캐시 연결');
  document.querySelector('#wallet-connection-summary').textContent = wallet.connected
    ? wallet.learner + ' 프로필 · 학습 앱과 캐시를 공유 중이에요.'
    : '학습 앱 프로필에 연결해 같은 캐시를 사용해요.';
  document.querySelector('#coming-soon').textContent = wallet.connected
    ? wallet.learner + ' 학습캐시 연결됨 · 게임 돌봄 상태는 이 기기에 저장'
    : DEFAULT_NOTICE;
}

function isSleeping(now = new Date()) {
  return !Care.Rules.awake(now);
}
function renderCareMenu(now = new Date()) {
  const sleeping = isSleeping(now);
  document.querySelectorAll('[data-action]').forEach(button => {
    const action = button.dataset.action;
    if (!['밥 주기', '간식', '놀기', '산책', '훈련'].includes(action)) return;
    button.disabled = sleeping || (action === '밥 주기' && (feeding || !!storageError));
    button.title = sleeping ? '강아지가 자고 있어요. 아침 6시부터 이용할 수 있어요.' : action === '밥 주기' ? document.querySelector('#meal-hint').textContent : '';
  });
}
function renderPuppyEmotion(now = new Date()) {
  const happy = document.querySelector('#puppy-happy');
  // Keep the existing character visible if the happy image is still loading or fails.
  const showHappy = puppyEmotion !== 'idle' && happy.complete && happy.naturalWidth > 0;
  const idle = document.querySelector('#puppy-idle');
  const sleeping = isSleeping(now);
  const showSleep = sleeping && !showHappy;
  const scene = document.querySelector('.puppy-scene');
  const showToyPlay = !showHappy && !showSleep && !!scene.dataset.play;
  const sad = document.querySelector('#puppy-sad');
  maybeShowHungerGreeting(now);
  const missedMealSad = !!gameState?.waitingForFood;
  const showSad = !showHappy && !showSleep && !showToyPlay && (hungerGreetingActive || missedMealSad) && sad.complete && sad.naturalWidth > 0;
  sad.hidden = !showSad;
  const bondImage = document.querySelector('#puppy-bond');
  const bondReady = document.querySelector('#bond-sheet').complete && document.querySelector('#bond-sheet').naturalWidth > 0;
  const friendImage = document.querySelector('#puppy-bond-friend');
  const bondVisible = !showHappy && !showSleep && !showSad && !showToyPlay && gameState?.rulesVersion === 2;
  const showFriend = bondVisible && gameState.stats.affection >= 20 && gameState.stats.affection < 40 && friendImage.complete && friendImage.naturalWidth > 0;
  friendImage.hidden = !showFriend;
  const showBond = bondVisible && !showFriend && bondReady;
  const index = gameState?.newlyAdopted ? 0 : Math.min(4, Math.floor((gameState?.stats.affection || 0) / 20));
  bondImage.setAttribute('viewBox', [22,328,632,936,1234][index] + ' 128 283 252');
  if(showBond) bondImage.removeAttribute('hidden'); else bondImage.setAttribute('hidden', '');
  const sleepImage = document.querySelector('#puppy-sleep');
  if (showSleep) sleepImage.removeAttribute('hidden');
  else sleepImage.setAttribute('hidden', '');
  const toyPlayImage = document.querySelector('#puppy-toy-play');
  if (showToyPlay) toyPlayImage.removeAttribute('hidden');
  else toyPlayImage.setAttribute('hidden', '');
  scene.dataset.sleeping = String(sleeping);
  scene.setAttribute('aria-label', showSleep ? '포근한 침대에서 잠자는 블랙 그레이트데인' : '포근한 방의 블랙 그레이트데인');
  const speech = document.querySelector('#puppy-speech');
  if (puppyEmotion === 'idle') {
    if (temporarySpeech) speech.textContent = temporarySpeech;
    else if (sleeping) speech.textContent = '쿨쿨… 아침에 놀아요';
    else if (hungerGreetingActive) speech.textContent = '배고파요...';
    else if (gameState?.rulesVersion === 2 && gameState.waitingForFood) speech.textContent = '배고파요...';
    else if (gameState?.rulesVersion === 2) {
      const message = [...BOND_MESSAGES].reverse().find(item => gameState.stats.affection >= item.min) || BOND_MESSAGES[0];
      speech.textContent = message.speech;
    } else speech.textContent = '나랑 놀아줘';
  }
  // SVG elements need the actual hidden attribute, not an HTML-only property.
  if (showSad) scene.setAttribute('aria-label', '밥을 기다리는 슬픈 블랙 그레이트데인');
  const currentBondMessage = [...BOND_MESSAGES].reverse().find(item => gameState?.stats && gameState.stats.affection >= item.min) || BOND_MESSAGES[0];
  document.querySelector('#mood-label').textContent = sleeping ? '꿈나라' : hungerGreetingActive ? Care.getFullness(gameState.stats.fullness).stage.label : gameState?.rulesVersion === 2 ? currentBondMessage.label : DISPLAY_FIXTURES.mood;
  if (showHappy || showSleep || showSad || showBond || showFriend || showToyPlay) idle.setAttribute('hidden', '');
  else idle.removeAttribute('hidden');
  happy.hidden = !showHappy;
  const frame = document.querySelector('#puppy-action-frame');
  frame.hidden = !showHappy;
  frame.dataset.scene = puppyEmotion;
  happy.alt = puppyEmotion === 'snack' ? '간식을 받아 먹는 블랙 그레이트데인' : '밥그릇에서 밥을 먹는 블랙 그레이트데인';
  renderCareMenu(now);
}

function maybeShowHungerGreeting(now = new Date()) {
  if (hungerGreetingHandled || !gameState?.profile || gameState.rulesVersion !== 2 || gameState.stats.fullness >= 70 || isSleeping(now)) return;
  hungerGreetingHandled = true;
  hungerGreetingActive = true;
  clearTimeout(hungerGreetingTimer);
  hungerGreetingTimer = setTimeout(() => {
    hungerGreetingActive = false;
    renderPuppyEmotion();
  }, 4000);
}

function showTemporarySpeech(message, duration = 4000) {
  hungerGreetingHandled = true;
  hungerGreetingActive = false;
  clearTimeout(hungerGreetingTimer);
  clearTimeout(speechTimer);
  puppyEmotion = 'idle';
  temporarySpeech = message;
  document.querySelector('#puppy-speech').textContent = message;
  renderPuppyEmotion();
  speechTimer = setTimeout(() => {
    temporarySpeech = '';
    puppyEmotion = 'idle';
    renderPuppyEmotion();
  }, duration);
}

function setPuppyEmotion(emotion) {
  puppyEmotion = emotion;
  renderPuppyEmotion();
}

function showMealSpeech(message = '마리야 고마워, 냠냠', emotion = 'meal') {
  hungerGreetingHandled = true;
  hungerGreetingActive = false;
  clearTimeout(hungerGreetingTimer);
  globalThis.PuppyToyUI?.stopReaction();
  clearTimeout(speechTimer);
  temporarySpeech = '';
  const speech = document.querySelector('#puppy-speech');
  speech.textContent = message;
  setPuppyEmotion(emotion);
  speechTimer = setTimeout(() => {
    setPuppyEmotion('idle');
  }, 4000);
}

document.querySelector('#puppy-happy').addEventListener('load', () => renderPuppyEmotion());
document.querySelector('#puppy-happy').addEventListener('error', () => renderPuppyEmotion());
document.querySelector('#puppy-sad').addEventListener('load', () => renderPuppyEmotion());
document.querySelector('#puppy-sad').addEventListener('error', () => renderPuppyEmotion());
document.querySelector('#bond-sheet').addEventListener('load', () => renderPuppyEmotion());
document.querySelector('#bond-sheet').addEventListener('error', () => renderPuppyEmotion());
document.querySelector('#puppy-bond-friend').addEventListener('load', () => renderPuppyEmotion());
document.querySelector('#puppy-bond-friend').addEventListener('error', () => renderPuppyEmotion());
document.querySelector('#toy-play-sheet').addEventListener('load', () => renderPuppyEmotion());
document.querySelector('#toy-play-sheet').addEventListener('error', () => renderPuppyEmotion());

function notify(message, persistent = false) {
  clearTimeout(noticeTimer);
  document.querySelector('#coming-soon').textContent = message;
  if (!persistent) noticeTimer = setTimeout(() => {
    document.querySelector('#coming-soon').textContent = storageError || (IS_PREVIEW ? '미리보기 · 밥 주기와 간식을 눌러 장면을 확인하세요' : pet ? DEFAULT_NOTICE : '미리보기 · 이름을 정하면 식사 기록이 저장돼요');
  }, 4000);
}
function reportStorageError(error) {
  storageError = '기록을 저장하거나 읽을 수 없어요. 브라우저 저장 공간을 확인해 주세요.';
  console.error('Local puppy storage:', error);
  const status = document.querySelector('#storage-status');
  status.hidden = false;
  status.textContent = storageError;
  feedButton.disabled = true;
  resetMealsButton.disabled = true;
  notify(storageError, true);
  renderSnackPanel(gameState || previewState(new Date()));
}
function clearStorageError() {
  storageError = '';
  document.querySelector('#storage-status').hidden = true;
}
function previewState(now) {
  const date = Care.dateKey(now);
  return {
    growthStage: 'baby', profile: null, date, stats: { affection: careRepo ? Care.clamp(Care.Rules.SETTINGS.initialAffection + careRepo.toySnapshot(now).rewards.reduce((sum, event) => sum + event.affection, 0)) : Care.Rules.SETTINGS.initialAffection, fullness: Care.Rules.SETTINGS.initialFullness },
    toys: careRepo ? careRepo.toySnapshot(now) : null,
    meals: Care.MEALS.map(meal => ({ ...meal, ...Care.mealStatus(date, meal, false, now) })),
    snacks: { inventory: Object.fromEntries(Care.SNACKS.map(snack => [snack.id, 0])), testBalance: Care.DEMO_CASH, usedToday: 0, remaining: Care.SNACK_LIMIT, atomicCommerce: supportsSnackWrites }
  };
}
function renderSnackPanel(state) {
  const snacks = state.snacks;
  const wallet = getWalletState();
  const cash = displayedCash(state);
  const blocked = !state.profile || !!storageError || !snacks.atomicCommerce || snackBusy;
  resetMealsButton.disabled = feeding || snackBusy || !!storageError || !state.profile;
  document.querySelector('#snack-menu-count').textContent = snacks.usedToday + '/3';
  document.querySelector('#snack-daily-count').textContent = '오늘 ' + snacks.usedToday + '/3개';
  document.querySelector('#snack-remaining').textContent = snacks.usedToday >= Care.SNACK_LIMIT
    ? '오늘 간식은 다 먹었어요! 내일 다시 주세요 🐶'
    : '오늘은 간식을 ' + snacks.remaining + '개 더 줄 수 있어요.';
  document.querySelector('#snack-panel-cash').textContent = Number.isSafeInteger(cash) ? cash.toLocaleString('ko-KR') : '—';
  document.querySelector('#snack-title').textContent = { feed: '간식 주기', shop: '간식 상점', inventory: '인벤토리' }[snackView];
  const inventoryView = snackView === 'inventory';
  const hasOwnedSnacks = Care.SNACKS.some(snack => snacks.inventory[snack.id] > 0);
  document.querySelector('#snack-limit-rule').hidden = snackView === 'shop' || (inventoryView && state.rulesVersion !== 2);
  document.querySelector('#snack-wallet-note').hidden = snackView !== 'shop';
  document.querySelector('#snack-wallet-label').textContent = wallet.connected ? '학습캐시' : '테스트 캐시';
  document.querySelector('#snack-wallet-caption').textContent = wallet.connected
    ? wallet.learner + ' 학습 앱 잔액에서 차감돼요.'
    : '실제 학습캐시와 분리된 이 기기 테스트 잔액이에요.';
  document.querySelector('#snack-footnote').hidden = snackView !== 'shop';
  document.querySelector('#snack-cards').dataset.view = snackView;
  document.querySelector('#snack-cards').hidden = inventoryView && !hasOwnedSnacks;
  for (const snack of Care.SNACKS) {
    document.querySelector('#snack-item-' + snack.id).hidden = inventoryView && snacks.inventory[snack.id] < 1;
    document.querySelector('#snack-stock-' + snack.id).textContent = snacks.inventory[snack.id];
    document.querySelector('#snack-effects-' + snack.id).hidden = inventoryView;
    document.querySelector('#snack-price-' + snack.id).hidden = snackView !== 'shop';
    const give = document.querySelector('#give-snack-' + snack.id);
    const buy = document.querySelector('#buy-snack-' + snack.id);
    give.hidden = snackView === 'shop';
    buy.hidden = snackView !== 'shop';
    give.disabled = blocked || snacks.usedToday >= Care.SNACK_LIMIT || snacks.inventory[snack.id] < 1;
    buy.disabled = blocked || !Number.isSafeInteger(cash) || cash < snack.price;
    give.textContent = snacks.usedToday >= Care.SNACK_LIMIT ? '오늘은 끝!' : snacks.inventory[snack.id] < 1 ? '보유 없음' : '간식 주기';
    buy.textContent = !Number.isSafeInteger(cash) || cash < snack.price ? '캐시 부족' : wallet.connected ? '구매하기' : '테스트 구매';
    document.querySelector('#snack-effects-' + snack.id).textContent = '친밀도 +'+snack.affection+' · 포만감 +'+snack.fullness;
    document.querySelector('#snack-price-' + snack.id).textContent = snack.price + (wallet.connected ? ' 학습캐시' : ' 테스트 캐시');
    give.setAttribute('aria-label', snack.label + ' 주기 · 보유 ' + snacks.inventory[snack.id] + '개');
    buy.setAttribute('aria-label', snack.label + (wallet.connected ? ' 구매 · 학습캐시 ' : ' 테스트 구매 · ') + snack.price + 'P');
  }
  const guidance = inventoryView ? '아직 보유한 간식이 없어요. 상점에서 구매해 주세요.' : snackView === 'shop' ? '원하는 간식을 테스트 캐시로 구매해 보세요.' : '간식이 없다면 메인 화면의 상점에서 구매해 주세요.';
  const message = document.querySelector('#snack-message');
  document.querySelector('#snack-footnote').textContent = wallet.connected
    ? '구매는 마리 프로필 학습캐시에서 차감되고, 구매 내역은 연결된 게임에서 복원돼요.'
    : '구매 횟수 제한은 없어요. 테스트 간식은 실제로 줄 때 보유 수량이 줄어요.';
  message.hidden = inventoryView && hasOwnedSnacks && !storageError;
  message.textContent = storageError || (!state.profile && !inventoryView ? '이름과 성별을 정한 뒤 간식을 줄 수 있어요.' : !snacks.atomicCommerce && !inventoryView ? '이 브라우저는 안전한 간식 저장을 지원하지 않아요. 최신 브라우저에서 열어 주세요.' : wallet.connected && !Number.isSafeInteger(wallet.balance) ? '학습 앱 잔액을 불러오는 중이에요.' : snackPanelMessage || guidance);
}
function openSnacks(view = 'feed') {
  snackView = view;
  snackPanelMessage = '';
  refreshCare(true);
  renderSnackPanel(gameState || previewState(new Date()));
  if (!snackDialog.open) snackDialog.showModal();
}
function snackRequestId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
async function handleSnack(type, snackId) {
  if (snackBusy) return;
  if (!pet || !careRepo || storageError) {
    snackPanelMessage = '먼저 이름과 성별을 정해 주세요.';
    renderSnackPanel(gameState || previewState(new Date()));
    return;
  }
  snackBusy = true;
  renderSnackPanel(gameState);
  try {
    const requestId = snackRequestId();
    let result;
    if (type === 'buy' && getWalletState().connected) {
      const snack = Care.SNACKS.find(item => item.id === snackId);
      const charge = await globalThis.PuppyWallet.spend(snack.price, requestId, 'snack', snackId);
      if (!charge.ok) result = { ok: false, reason: charge.reason };
      else {
        result = await careRepo.buySnackExternal(snackId, requestId);
        if (!result.ok && result.reason === 'duplicate-request') result = { ok: true, snack, state: careRepo.snapshot() };
      }
    } else result = type === 'buy' ? await careRepo.buySnack(snackId, requestId) : await careRepo.giveSnack(snackId, requestId);
    if (result.state) { gameState = result.state; pet = gameState.profile; }
    if (result.ok) {
      snackPanelMessage = type === 'buy' ? result.snack.label + ' 1개를 ' + (getWalletState().connected ? '학습캐시 ' : '테스트 캐시 ') + result.snack.price + 'P로 구매했어요.' : result.snack.label + '을 맛있게 먹었어요!';
      renderPet(gameState, new Date());
      if (type === 'give') {
        if (snackDialog.open) snackDialog.close();
        showMealSpeech('마리야 간식 고마워! 🥰', 'snack');
        notify(snackPanelMessage);
      }
    } else {
      const messages = {
        'daily-limit': '오늘 간식은 다 먹었어요! 내일 다시 주세요 🐶',
        'out-of-stock': '보유한 간식이 없어요. 간식 상점에서 구매해 주세요.',
        'insufficient-cash': getWalletState().connected ? '학습캐시가 부족해요.' : '테스트 캐시가 부족해요.',
        'not-connected': '학습 앱 프로필에 연결해 주세요.',
        'permission-denied': '연결된 Google 계정을 확인해 주세요. 구매는 등록된 보호자 계정만 할 수 있어요.',
        'not-found': '구매 서버가 아직 준비 중이에요. 캐시는 차감되지 않았어요.',
        'failed-precondition': '학습캐시 잔액을 확인할 수 없어 구매하지 않았어요.',
        'duplicate-request': '이미 처리한 간식이에요.',
        'no-profile': '먼저 이름과 성별을 정해 주세요.',
        'unsupported-storage': '이 브라우저는 안전한 간식 저장을 지원하지 않아요.'
      };
      snackPanelMessage = messages[result.reason] || '간식 정보를 다시 확인해 주세요.';
    }
  } catch (error) { reportStorageError(error); }
  finally {
    snackBusy = false;
    renderSnackPanel(gameState || previewState(new Date()));
    globalThis.PuppyActivityUI?.render();
  }
}
document.querySelector('#close-snack-dialog').addEventListener('click', () => snackDialog.close());
for (const snack of Care.SNACKS) {
  document.querySelector('#give-snack-' + snack.id).addEventListener('click', () => handleSnack('give', snack.id));
  document.querySelector('#buy-snack-' + snack.id).addEventListener('click', () => handleSnack('buy', snack.id));
}
function mealHint(state, now) {
  if (isSleeping(now)) return '강아지가 자고 있어요. 아침 6시부터 이용할 수 있어요.';
  if (IS_PREVIEW) return '미리보기 · 언제든 밥 주기를 눌러 장면을 확인하세요.';
  if (!state.profile) return '이름과 성별을 정하면 밥을 줄 수 있어요.';
  const available = state.meals.find(meal => meal.available);
  if (available) return '지금은 ' + available.label + ' 시간! 아래 ‘밥 주기’를 눌러 주세요.';
  const korean = Care.Rules.koreanDate(now);
  const minutes = korean.getUTCHours() * 60 + korean.getUTCMinutes();
  const next = Care.MEALS.find(meal => minutes < meal.start * 60);
  return next ? '다음 식사는 ' + next.label + ' ' + next.time + '예요.' : '다음 식사는 내일 아침 07~10시예요.';
}
function renderMeals(state, now) {
  document.querySelector('#meal-date').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone:'Asia/Seoul' }).format(now);
  for (const meal of state.meals) {
    const card = document.querySelector('#meal-' + meal.id);
    card.dataset.status = meal.status;
    card.classList.toggle('is-available', meal.available && !!state.profile);
    card.querySelector('.meal-state').textContent = meal.stateLabel + ' ' + meal.emoji;
    card.setAttribute('aria-label', meal.label + ' ' + meal.time + ' · ' + meal.stateLabel);
  }
  const hint = mealHint(state, now);
  document.querySelector('#meal-hint').textContent = hint;
  feedButton.title = hint;
  feedButton.setAttribute('aria-label', '밥 주기 · ' + hint);
  feedButton.classList.toggle('meal-active', !!state.profile && state.meals.some(meal => meal.available));
  feedButton.disabled = feeding || !!storageError;
  resetMealsButton.disabled = feeding || snackBusy || !!storageError || !state.profile;
}
function renderPet(state, now) {
  const profile = state.profile;
  const visual = GROWTH_VISUALS[state.growthStage] || GROWTH_VISUALS.baby;
  document.querySelector('#pet-name').textContent = profile?.name || '강아지';
  const gender = document.querySelector('#pet-gender');
  gender.hidden = !profile?.gender;
  gender.textContent = profile?.gender === 'female' ? '♀' : '♂';
  gender.dataset.gender = profile?.gender || '';
  gender.setAttribute('aria-label', profile?.gender === 'female' ? '암컷' : '수컷');
  document.querySelector('#growth-label').textContent = visual.label;
  const scene = document.querySelector('.puppy-scene');
  scene.dataset.growth = state.growthStage;
  scene.style.setProperty('--pet-scale', visual.scale);
  document.querySelector('#puppy-character').setAttribute('href', visual.image);
  const bond = Care.getBond(state.stats.affection);
  document.querySelector('#bond-score').textContent = bond.value;
  document.querySelector('#bond-emoji').textContent = bond.stage.emoji;
  document.querySelector('#bond-level').textContent = bond.stage.label;
  document.querySelector('#next-bond').textContent = bond.next ? '다음 단계까지 ' + (bond.next.min - bond.value) : '최고의 가족이 되었어요';
  document.querySelector('.progress-fill').style.width = bond.value + '%';
  document.querySelector('.progress-track').setAttribute('aria-valuenow', bond.value);
  const fullness = Care.getFullness(state.stats.fullness);
  document.querySelector('#hunger-emoji').textContent = fullness.stage.emoji;
  document.querySelector('#hunger-label').textContent = fullness.stage.label;
  document.querySelector('#fullness-score').textContent = fullness.value + '/100';
  document.querySelector('#fullness-fill').style.width = fullness.value + '%';
  document.querySelector('#fullness-track').setAttribute('aria-valuenow', fullness.value);
  renderWallet(state);
  const bondMessage = [...BOND_MESSAGES].reverse().find(item => bond.value >= item.min) || BOND_MESSAGES[0];
  document.querySelector('#mood-label').textContent = state.rulesVersion===2 ? isSleeping(now) ? '꿈나라' : state.waitingForFood ? '밥을 기다려요' : bondMessage.label : DISPLAY_FIXTURES.mood;
  document.querySelector('#mood-test').hidden = state.rulesVersion===2;
  renderMeals(state, now);
  renderPuppyEmotion(now);
  renderSnackPanel(state);
  globalThis.PuppyToyUI?.render();
  globalThis.PuppyActivityUI?.render();
}
function refreshCare(force = false, now = new Date()) {
  const minute = Care.dateKey(now) + ':' + now.getHours() + ':' + now.getMinutes() + ':' + now.getTimezoneOffset();
  if (!force && minute === lastMinute) return;
  lastMinute = minute;
  try {
    if (!careRepo) throw new Error('Local storage unavailable');
    gameState = careRepo.snapshot(now);
    pet = gameState?.profile || null;
    clearStorageError();
    renderPet(gameState || previewState(now), now);
  } catch (error) { reportStorageError(error); }
}
function updateClock() {
  const now = new Date();
  const clock = document.querySelector('#local-time');
  clock.textContent = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  clock.dateTime = now.toISOString();
  const date = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  document.querySelector('#local-date').textContent = date;
  clock.title = date;
  refreshCare(false, now);
}
function showHome() {
  refreshCare(true);
  welcome.classList.add('hidden');
  home.classList.remove('hidden');
  document.querySelector('#pet-name').focus({ preventScroll: true });
  window.scrollTo(0, 0);
  notify(storageError || (pet ? DEFAULT_NOTICE : '미리보기 · 이름을 정하면 식사 기록이 저장돼요'), true);
}
async function feedMeal() {
  if (IS_PREVIEW) {
    showMealSpeech();
    notify('미리보기 · 밥 먹는 장면을 보여드려요. 식사 기록은 저장하지 않아요.');
    return;
  }
  if (feeding) return;
  if (!pet) { notify('먼저 이름과 성별을 정해 주세요. 이름 옆 연필을 눌러 주세요.'); return; }
  if (!careRepo || storageError) { notify(storageError || '저장 공간을 사용할 수 없어요.', true); return; }
  feeding = true;
  feedButton.disabled = true;
  try {
    const result = await careRepo.feed();
    gameState = result.state;
    if (gameState) {
      pet = gameState.profile;
      renderPet(gameState, new Date());
    }
    if (result.ok) {
      notify(result.meal.label + '을 맛있게 먹었어요! 😋');
      showMealSpeech();
    }
    else if (result.reason === 'already-eaten') notify(result.meal.label + '은 이미 먹었어요. 다음 식사에 만나요!');
    else if (result.reason === 'outside-window') notify('지금은 식사 시간이 아니에요. ' + mealHint(gameState, new Date()));
    else notify('먼저 강아지 이름과 성별을 정해 주세요.');
  } catch (error) { reportStorageError(error); }
  finally {
    feeding = false;
    feedButton.disabled = isSleeping() || !!storageError;
    resetMealsButton.disabled = snackBusy || !!storageError || !pet;
    globalThis.PuppyActivityUI?.render();
  }
}
async function resetCareForTesting() {
  if (feeding || snackBusy || !pet || !careRepo || storageError) return;
  feeding = true;
  snackBusy = true;
  feedButton.disabled = true;
  resetMealsButton.disabled = true;
  renderSnackPanel(gameState);
  try {
    gameState = await careRepo.resetCareForTesting();
    clearTimeout(speechTimer);
    clearTimeout(hungerGreetingTimer);
    hungerGreetingActive = false;
    hungerGreetingHandled = false;
    globalThis.PuppyToyUI?.stopReaction();
    document.querySelector('.puppy-scene').dataset.play = '';
    renderPuppyEmotion();
    setPuppyEmotion('idle');
    snackPanelMessage = '';
    refreshCare(true);
    notify('강아지가 처음 상태로 돌아왔어요. 테스트 캐시는 1,000이에요.');
  } catch (error) { reportStorageError(error); }
  finally {
    feeding = false;
    snackBusy = false;
    feedButton.disabled = !!storageError;
    resetMealsButton.disabled = !!storageError || !pet;
    renderSnackPanel(gameState || previewState(new Date()));
    globalThis.PuppyActivityUI?.render();
  }
}
resetMealsButton.addEventListener('click', resetCareForTesting);
function clearProfileLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('name') && !params.has('gender') && !params.has('welcome')) return;
  params.delete('name');
  params.delete('gender');
  params.delete('welcome');
  const query = params.toString();
  globalThis.history?.replaceState(null, '', location.pathname + (query ? '?' + query : '') + (location.hash || ''));
}
nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const name = nameInput.value.trim();
  if (!name) { nameInput.setCustomValidity('강아지 이름을 입력해 주세요.'); nameInput.reportValidity(); return; }
  if (!form.reportValidity()) return;
  saving = true;
  submitButton.disabled = true;
  try {
    if (!careRepo) throw new Error('Local storage unavailable');
    gameState = await careRepo.saveProfile({ name, gender: new FormData(form).get('gender') });
    pet = gameState.profile;
    clearProfileLink();
    IS_PREVIEW = false;
    clearStorageError();
    showHome();
  } catch (error) { reportStorageError(error); }
  finally { saving = false; submitButton.disabled = false; }
});
document.querySelector('#preview-button').addEventListener('click', () => { IS_PREVIEW = true; showHome(); });
document.querySelector('#edit-profile').addEventListener('click', () => {
  home.classList.add('hidden');
  welcome.classList.remove('hidden');
  nameInput.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    if (isSleeping() && ['밥 주기', '간식', '놀기', '산책', '훈련'].includes(button.dataset.action)) return;
    if (button.dataset.action === '밥 주기') feedMeal();
    else if (button.dataset.action === '간식') {
      if (IS_PREVIEW) { showMealSpeech('마리야 간식 고마워! 🥰', 'snack'); notify('미리보기 · 간식 받는 장면을 보여드려요. 재고는 차감하지 않아요.'); }
      else openSnacks('feed');
    }
    else if (button.dataset.action === '놀기') globalThis.PuppyToyUI?.open('play');
    else if (button.dataset.action === '훈련') globalThis.PuppyActivityUI?.open('train');
    else if (button.dataset.action === '산책') globalThis.PuppyActivityUI?.open('walk');
    else if (button.dataset.action === '상점') openSnacks('shop');
    else if (button.dataset.action === '인벤토리') openSnacks('inventory');
    else notify(button.dataset.action + ' 기능은 준비 중이에요.');
  });
});
const walletDialog = document.querySelector('#wallet-dialog');
document.querySelector('#wallet-close-button').addEventListener('click', () => walletDialog.close());
document.querySelector('#wallet-link-button').addEventListener('click', () => {
  const wallet = getWalletState();
  document.querySelector('#wallet-profile-name').value = wallet.learner || '';
  document.querySelector('#wallet-connect-status').textContent = wallet.connected ? wallet.learner + ' 프로필에 연결되어 있어요.' : '';
  document.querySelector('#wallet-disconnect-button').hidden = !wallet.connected;
  if (!walletDialog.open) walletDialog.showModal();
});
document.querySelector('#wallet-connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#wallet-connect-status');
  const button = document.querySelector('#wallet-connect-submit');
  button.disabled = true;
  status.textContent = '학습 앱 프로필을 확인하고 있어요…';
  try {
    const result = await globalThis.PuppyWallet.connect();
    if (!result.ok) {
      status.textContent = result.reason === 'profile-not-found' ? '학습 앱에서 마리 프로필을 찾지 못했어요.' : '연결을 확인해 주세요.';
      return;
    }
    status.textContent = result.balance === null ? '연결했지만 잔액을 읽지 못했어요.' : '연결 완료! 현재 학습캐시 ' + result.balance.toLocaleString('ko-KR') + 'P예요.';
    renderWallet(gameState);
    renderSnackPanel(gameState || previewState(new Date()));
    globalThis.PuppyToyUI?.render();
  } catch (error) {
    console.error('학습캐시 연결 실패:', error);
    status.textContent = 'Firebase 연결에 실패했어요. 인터넷 연결과 프로필을 확인해 주세요.';
  } finally { button.disabled = false; }
});
document.querySelector('#wallet-disconnect-button').addEventListener('click', () => {
  globalThis.PuppyWallet.disconnect();
  document.querySelector('#wallet-connect-status').textContent = '학습 앱 연결을 해제했어요. 테스트 캐시로 전환합니다.';
  document.querySelector('#wallet-disconnect-button').hidden = true;
  renderWallet(gameState);
  renderSnackPanel(gameState || previewState(new Date()));
  globalThis.PuppyToyUI?.render();
});
function bindPuppyWallet() {
  if (!globalThis.PuppyWallet || bindPuppyWallet.bound) return;
  bindPuppyWallet.bound = true;
  globalThis.PuppyWallet.subscribe(state => {
    sharedWalletState = state;
    renderWallet(gameState);
    renderSnackPanel(gameState || previewState(new Date()));
    globalThis.PuppyToyUI?.render();
    if (state.connected && careRepo && gameState?.profile) {
      globalThis.PuppyWallet.purchases().then(receipts => careRepo.importExternalPurchases(receipts)).then(result => {
        if (result?.imported) refreshCare(true);
      }).catch(error => console.error('학습 앱 구매 기록 복구 실패:', error));
    }
  });
}
window.addEventListener('puppywalletready', bindPuppyWallet);
bindPuppyWallet();
async function initializeCare() {
try {
  const lockManager = globalThis.navigator?.locks;
  supportsSnackWrites = !!lockManager;
  careRepo = Care.repository(window.localStorage, {
    withLock: lockManager ? task => lockManager.request('our-puppy-care', { mode: 'exclusive' }, task) : task => task(),
    atomicCommerce: supportsSnackWrites
  });
  // Recover a name submitted through the HTML form before its JS handler loaded.
  // Consume these parameters once so a stale address cannot undo later edits.
  const params = new URLSearchParams(location.search);
  const linkedName = params.get('name')?.trim();
  const linkedGender = params.get('gender');
  if (linkedName && linkedName.length <= 12 && ['male', 'female'].includes(linkedGender)) {
    await careRepo.saveProfile({ name: linkedName, gender: linkedGender });
    clearProfileLink();
  }
  refreshCare(true);
  if (pet) {
    nameInput.value = pet.name;
    form.querySelector('[value="' + pet.gender + '"]').checked = true;
    if (!FORCE_WELCOME) showHome();
  }
} catch (error) { reportStorageError(error); }
}
const initialization = initializeCare();
updateClock();
setInterval(updateClock, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastMinute = ''; updateClock(); } });
window.addEventListener('focus', () => { lastMinute = ''; updateClock(); });
window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith(Care.PREFIX)) {
    refreshCare(true);
    if (!storageError) notify(pet ? DEFAULT_NOTICE : '미리보기 · 이름을 정하면 식사 기록이 저장돼요', true);
  }
});
if (new URLSearchParams(location.search).get('preview') === '1') showHome();
