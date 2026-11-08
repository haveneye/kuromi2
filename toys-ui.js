/* Standalone UI; uses the same care lock, but an isolated toy test wallet. */
(function () {
  'use strict';
  const Toys = globalThis.PuppyToys;
  const $ = selector => document.querySelector(selector);
  const dialog = $('#toy-dialog');
  let view = 'shop';
  let busy = false;
  let error = '';
  let feedback = '';
  let finishTimer;
  let reactionTimer;
  const messages = {
    'already-owned': '이미 소장한 장난감이에요. 다시 구매하지 않아도 돼요.',
    'insufficient-cash': '장난감 테스트캐시가 부족해요.',
    'not-owned': '상점에서 먼저 구매해 주세요.',
    'sleeping': '지금은 잠자는 시간이에요. 아침 6시에 다시 놀아요. 친밀도는 줄지 않아요.',
    'hungry': '배가 고파서 놀 수 없어요. 먼저 밥을 주세요!',
    'daily-limit': '오늘은 충분히 놀았어요! 내일 또 놀아요.',
    'affection-limit': '오늘은 신나게 놀았어요! 내일 또 놀아요.',
    'duplicate-request': '이미 처리한 놀이예요. 보상은 한 번만 반영돼요.',
    'unsupported-storage': '안전한 저장을 지원하는 최신 브라우저에서 다시 열어 주세요.'
  };
  function setFeedback(message) {
    feedback = message;
    $('#toy-feedback').hidden = !message;
    $('#toy-feedback').textContent = message;
  }
  function render() {
    let state;
    try {
      if (!careRepo) throw new Error('storage');
      state = careRepo.toySnapshot();
      error = '';
    } catch (_) { error = '장난감 기록을 읽을 수 없어요. 기존 기록은 그대로 보관하고 있어요.'; }
    $('.puppy-scene').dataset.sleeping = String(!!state?.sleeping);
    if (!busy && puppyEmotion === 'idle') {
      if (state?.sleeping && $('#puppy-speech').textContent === '나랑 놀아줘') $('#puppy-speech').textContent = '쿨쿨… 아침에 놀아요';
      else if (!state?.sleeping && $('#puppy-speech').textContent === '쿨쿨… 아침에 놀아요') $('#puppy-speech').textContent = '나랑 놀아줘';
    }
    $('#toy-title').textContent = { shop: '장난감 상점', play: '함께 놀아요', inventory: '장난감 인벤토리' }[view];
    $('#toy-cards').dataset.view = view;
    const wallet = globalThis.PuppyWallet?.snapshot?.() || { connected: false, balance: null };
    const balance = wallet.connected ? wallet.balance : state?.balance;
    $('#toy-balance').textContent = Number.isSafeInteger(balance) ? balance.toLocaleString('ko-KR') : '—';
    $('#toy-wallet-label').textContent = wallet.connected ? '학습캐시' : '장난감 테스트캐시';
    $('#toy-wallet-caption').textContent = wallet.connected ? wallet.learner + ' 프로필 잔액 · 구매 시 바로 차감' : '단독 테스트 · 이 브라우저에 저장\n학습 앱과 연결되지 않았어요';
    $('#toy-hours').textContent = state?.sleeping ? '지금은 꿈나라 · 06:00에 만나요' : '놀이 시간 06:00–22:00';
    $('#toy-daily').textContent = '친밀도 +' + (state?.earnedToday || 0) + '/10';
    $('#toy-count').textContent = (state?.playedToday || 0) + '/3회';
    $('#toy-daily-fill').style.width = ((state?.earnedToday || 0) / Toys.DAILY_LIMIT * 100) + '%';
    $('#toy-bond').textContent = gameState?.stats?.affection ?? '—';
    $('#toy-fullness').textContent = gameState?.stats?.fullness ?? '—';
    $('#toy-rule-detail').textContent = state?.sleeping ? '잠자는 동안 놀이는 쉬어요.' : gameState?.stats?.fullness <= Toys.MIN_PLAY_FULLNESS ? messages.hungry : state?.playedToday >= Toys.PLAY_LIMIT ? messages['daily-limit'] : state?.remaining === 0 ? messages['affection-limit'] : '포만도 21 이상 · 오늘 '+state.playsRemaining+'회 더 놀 수 있어요.';
    const empty = state && view !== 'shop' && !Object.keys(state.owned).length;
    $('#toy-empty').hidden = !empty;
    $('#toy-cards').hidden = !!empty || !!error;
    for (const tab of ['shop', 'play', 'inventory']) {
      $('#toy-tab-' + tab).setAttribute('aria-pressed', String(tab === view));
    }
    for (const toy of Toys.TOYS) {
      const owned = !!state?.owned[toy.id];
      $('#toy-card-' + toy.id).hidden = view !== 'shop' && !owned;
      $('#toy-owned-' + toy.id).hidden = !owned;
      const buy = $('#buy-toy-' + toy.id);
      buy.hidden = view !== 'shop' || owned;
      buy.disabled = busy || !!error || !supportsSnackWrites || !state || !Number.isSafeInteger(balance) || balance < toy.price;
      buy.textContent = !Number.isSafeInteger(balance) || balance < toy.price ? '캐시 부족' : '구매하기';
      buy.setAttribute('aria-label', toy.label + ' ' + toy.price + 'P 구매');
      const play = $('#play-toy-' + toy.id);
      play.hidden = !owned;
      $('#toy-card-' + toy.id + ' .toy-card-copy p').textContent = '친밀도 +'+toy.affection+' · 포만감 -'+toy.fullnessLoss;
      const blocked = gameState?.stats?.fullness <= Toys.MIN_PLAY_FULLNESS || state?.playedToday >= Toys.PLAY_LIMIT || state?.earnedToday >= Toys.DAILY_LIMIT;
      play.disabled = busy || !!error || !supportsSnackWrites || !!state?.sleeping || blocked;
      play.textContent = busy ? '놀고 있어요' : gameState?.stats?.fullness <= Toys.MIN_PLAY_FULLNESS ? '밥 먼저 먹기' : blocked ? '내일 또 놀기' : state?.sleeping ? '잠자는 중' : '같이 놀기';
      play.setAttribute('aria-label', toy.label + ' 놀이');
    }
    setFeedback(error || (!supportsSnackWrites ? messages['unsupported-storage'] : feedback));
  }
  function open(nextView) {
    view = nextView;
    setFeedback('');
    if (snackDialog.open) snackDialog.close();
    render();
    if (!dialog.open) dialog.showModal();
  }
  function showReaction(toy) {
    clearTimeout(reactionTimer);
    clearTimeout(speechTimer);
    setPuppyEmotion('idle');
    const scene = $('.puppy-scene');
    scene.dataset.play = toy.motion;
    // Individual crops account for a few illustrations that spill past the nominal sprite-cell edges.
    const poseCrop = {
      tennis:[0,0,320,512], bone:[350,0,275,512], rope:[620,0,300,512], squeaky:[930,0,274,512], disc:[1205,0,331,512],
      bear:[0,512,330,512], ball:[338,512,312,512], octopus:[652,512,278,512], bubbles:[925,512,309,512], nosework:[1238,512,298,512]
    }[toy.id] || [0,0,320,512];
    const sheet = $('#toy-play-sheet');
    const scaleX = sheet.naturalWidth ? sheet.naturalWidth / 1536 : 1;
    const scaleY = sheet.naturalHeight ? sheet.naturalHeight / 1024 : 1;
    const pose = $('#puppy-toy-play');
    pose.setAttribute('viewBox', `${poseCrop[0]*scaleX} ${poseCrop[1]*scaleY} ${poseCrop[2]*scaleX} ${poseCrop[3]*scaleY}`);
    pose.setAttribute('aria-label', toy.label + ' 가지고 노는 블랙 그레이트데인');
    showTemporarySpeech(toy.reaction);
    const art = $('#play-toy-art');
    art.hidden = true;
    $('#play-bubbles').hidden = true;
  }
  function stopReaction() {
    $('.puppy-scene').dataset.play = '';
    $('#play-toy-art').hidden = true;
    $('#play-bubbles').hidden = true;
    clearTimeout(speechTimer);
    temporarySpeech = '';
    if (puppyEmotion === 'idle') renderPuppyEmotion();
  }
  async function buy(toy) {
    if (busy) return;
    busy = true;
    setFeedback('');
    render();
    try {
      const requestId = snackRequestId();
      let result;
      if (globalThis.PuppyWallet?.snapshot?.().connected) {
        const charge = await globalThis.PuppyWallet.spend(toy.price, requestId, 'toy', toy.id);
        if (charge.ok) {
          result = await careRepo.buyToyExternal(toy.id, requestId);
          if (!result.ok && result.reason === 'duplicate-request') result = { ok: true };
        } else result = charge;
      } else result = await careRepo.buyToy(toy.id, requestId);
      feedback = result.ok ? toy.label + ' 구매 완료! 이제 언제든 함께 놀 수 있어요.' : messages[result.reason] || (result.reason === 'insufficient-cash' ? '학습캐시가 부족해요.' : '구매 정보를 다시 확인해 주세요.');
      refreshCare(true);
    } catch (_) { feedback = '구매를 저장하지 못했어요. 잔액과 소유 내역을 다시 확인해 주세요.'; }
    finally { busy = false; render(); }
  }
  function play(toy) {
    if (busy) return;
    try {
      const state = careRepo.toySnapshot();
      if (!state.owned[toy.id]) { setFeedback(messages['not-owned']); return; }
      if (state.sleeping) { setFeedback(messages.sleeping); render(); return; }
      if (gameState?.stats?.fullness <= Toys.MIN_PLAY_FULLNESS) { setFeedback(messages.hungry); render(); return; }
      if (state.playedToday >= Toys.PLAY_LIMIT) { setFeedback(messages['daily-limit']); render(); return; }
      if (state.earnedToday >= Toys.DAILY_LIMIT) { setFeedback(messages['affection-limit']); render(); return; }
      if (!supportsSnackWrites) { setFeedback(messages['unsupported-storage']); return; }
    } catch (_) { render(); return; }
    busy = true;
    const requestId = snackRequestId();
    render();
    dialog.close();
    showReaction(toy);
    notify('같이 놀고 있어요! ' + toy.label);
    // Reward only after the play completes. Reloading mid-animation grants nothing.
    clearTimeout(finishTimer);
    finishTimer = setTimeout(async () => {
      try {
        const result = await careRepo.playToy(toy.id, requestId);
        refreshCare(true);
        const message = result.ok ? (result.reward ? '친밀도 +' + result.reward + '! ' : '친밀도 +0 · ') + (result.reward ? toy.reaction : result.toys.remaining === 0 ? '오늘 놀이 보상은 모두 받았어요. 그래도 즐거웠어요!' : '친밀도가 이미 100이에요. 그래도 즐거웠어요!') : messages[result.reason] || '놀이 기록을 확인해 주세요.';
        setFeedback(message);
        notify(message);
      } catch (_) { setFeedback('놀이 기록을 저장하지 못했어요. 다시 확인해 주세요.'); notify(feedback); }
      finally {
        busy = false;
        render();
        reactionTimer = setTimeout(stopReaction, 2000);
      }
    }, 2000);
  }
  $('#close-toy-dialog').addEventListener('click', () => dialog.close());
  $('#open-toy-shop').addEventListener('click', () => open('shop'));
  $('#open-toy-inventory').addEventListener('click', () => open('inventory'));
  $('#toy-back-snacks').addEventListener('click', () => { dialog.close(); openSnacks('shop'); });
  $('#toy-empty-shop').addEventListener('click', () => open('shop'));
  for (const tab of ['shop', 'play', 'inventory']) $('#toy-tab-' + tab).addEventListener('click', () => open(tab));
  for (const toy of Toys.TOYS) {
    $('#buy-toy-' + toy.id).addEventListener('click', () => buy(toy));
    $('#play-toy-' + toy.id).addEventListener('click', () => play(toy));
  }
  globalThis.PuppyToyUI = Object.freeze({ open, render, stopReaction });
  render();
})();
