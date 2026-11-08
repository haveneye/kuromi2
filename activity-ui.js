// Training and walk records use the same local repository/lock as feeding.
(function() {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const Rules=Care.Rules;
  let view='train', busy=false, message='', activeTrickId='', sceneCaption='';
  const TRICK_VIEWS={sit:'22 687 283 216',paw:'328 687 283 216',down:'632 687 283 216',spin:'936 687 283 216',highfive:'1234 687 283 216'};
  function render() {
    const state=gameState, training=state?.training, current=training?.current;
    const blocked=busy||feeding||snackBusy||!!storageError||!supportsSnackWrites||!state?.profile||isSleeping();
    $('#training-summary-text').textContent=training?'오늘 훈련 '+training.usedToday+'/3 · '+(current?current.label+' '+training.mastery[current.id]+'%':'개인기 모두 습득!'):'오늘 훈련 0/3 · 이름을 먼저 정해 주세요';
    const next=training?Rules.TRICKS[training.learned.length+1]:null;
    const condition=!training?'이름을 정하면 훈련을 시작할 수 있어요.':!current?'다섯 가지 개인기를 모두 배웠어요!':state.stats.affection<current.bond?current.label+' 해금: 친밀도 '+current.bond+' 필요':next?current.label+' 100% 습득 후 '+next.label+' · 친밀도 '+next.bond:current.label+' 100%까지 함께 연습해요';
    $('#training-next').textContent=condition;
    $('#training-summary-progress').value=current?training.mastery[current.id]:training?100:0;
    $('#activity-title').textContent=view==='train'?'개인기 훈련':'오늘의 산책';
    $('#activity-rule').textContent=view==='train'?'오늘 '+(training?.usedToday||0)+'/'+Rules.SETTINGS.trainingLimit+'회 · 성공 확률 '+Math.round(Rules.SETTINGS.successChance*100)+'% · 성공 시 숙련도 +'+Rules.SETTINGS.masteryMin+'~'+Rules.SETTINGS.masteryMax+'% · 시도마다 포만감 '+Rules.SETTINGS.trainFullness:'06~22시 · 하루 한 번 완료를 기록할 수 있어요.';
    $('#training-list').hidden=view!=='train';
    $('#walk-panel').hidden=view!=='walk';
    const activeTrick=Rules.TRICKS.find(trick=>trick.id===activeTrickId);
    $('#training-scene').hidden=view!=='train'||!activeTrick;
    if(activeTrick) {
      $('#training-scene-art').setAttribute('viewBox',TRICK_VIEWS[activeTrick.id]||TRICK_VIEWS.sit);
      $('#training-scene-art').setAttribute('aria-label',activeTrick.label+' 개인기를 훈련하는 블랙 그레이트데인');
      $('#training-scene-title').textContent=activeTrick.label+' 연습 중';
      $('#training-scene-caption').textContent=sceneCaption;
    }
    for(const trick of Rules.TRICKS) {
      const mastery=training?.mastery[trick.id]||0;
      const learned=mastery>=100, active=current?.id===trick.id;
      $('#mastery-'+trick.id).value=mastery;
      $('#training-status-'+trick.id).textContent=learned?'습득 완료 · 100%':mastery+'% · '+(active?state.stats.affection>=trick.bond?'훈련 가능':'친밀도 '+trick.bond+' 필요':'이전 개인기 습득 필요');
      const button=$('#train-'+trick.id);
      button.disabled=blocked||!active||!training?.available;
      button.textContent=learned?'습득 완료':training?.remaining===0?'오늘 훈련 완료':'훈련하기';
    }
    $('#complete-walk').disabled=blocked||!!state?.walkedToday;
    $('#walk-status').textContent=state?.walkedToday?'오늘 산책을 완료했어요!':'산책 기록은 아직이에요.';
    $('#activity-message').textContent=storageError||(!state?.profile?'먼저 이름과 성별을 정해 주세요.':!supportsSnackWrites?'안전한 저장을 지원하는 브라우저에서 열어 주세요.':isSleeping()?'지금은 잠자는 시간이에요. 아침 6시에 만나요.':message||condition);
  }
  function open(nextView) {
    view=nextView;message='';activeTrickId='';sceneCaption='';refreshCare(true);render();
    if(!$('#activity-dialog').open) $('#activity-dialog').showModal();
  }
  async function perform(type,trickId) {
    if(busy||feeding||snackBusy) return;
    if(type==='train') {
      const trick=Rules.TRICKS.find(item=>item.id===trickId);
      activeTrickId=trickId;
      sceneCaption=(pet?.name||gameState?.profile?.name||'강아지')+'와 함께 '+(trick?.label||'개인기')+' 동작을 연습해요!';
    }
    busy=true;render();
    if(type==='train') $('#training-scene').scrollIntoView({block:'center',behavior:'smooth'});
    try {
      const result=type==='train'?await careRepo.train(trickId,snackRequestId()):await careRepo.completeWalk(snackRequestId());
      if(result.ok) {
        if(type==='walk') message='산책을 기록했어요! 친밀도 +3 · 포만감 -10';
        else if(result.event.success) message='훈련 성공! 숙련도 +'+result.event.gain+'% · 친밀도 +1 · 포만감 -3'+(result.state.training.mastery[trickId]===100?' · 개인기 습득 완료!':'');
        else message='이번 훈련은 실패했어요. 다음에 다시 연습해요! 숙련도 유지 · 포만감 -3';
        if(type==='train') sceneCaption=message;
      } else {
        message=({'daily-limit':'오늘 훈련 3회를 모두 마쳤어요. 내일 다시 만나요!',sequence:'앞 개인기를 완전히 배운 뒤 훈련할 수 있어요.','bond-required':'아직 친밀도가 부족해요. 함께 돌보며 가까워져요!','already-walked':'오늘 산책은 이미 기록했어요.',sleeping:'지금은 잠자는 시간이에요.','unsupported-storage':'이 브라우저는 안전한 저장을 지원하지 않아요.','no-profile':'먼저 이름을 정해 주세요.'})[result.reason]||'이미 처리했거나 지금은 이용할 수 없어요.';
        if(type==='train') sceneCaption=message;
      }
      refreshCare(true);notify(message);
      render();
    } catch(error) { reportStorageError(error);message='기록을 확인해 주세요. 저장되지 않은 성공을 표시하지 않아요.';if(type==='train')sceneCaption=message; }
    finally {busy=false;render();}
  }
  $('#open-training-summary').addEventListener('click',()=>open('train'));
  $('#close-activity').addEventListener('click',()=>$('#activity-dialog').close());
  $('#activity-dialog').addEventListener('close',()=>{activeTrickId='';sceneCaption='';render();});
  $('#complete-walk').addEventListener('click',()=>perform('walk'));
  for(const trick of Rules.TRICKS) $('#train-'+trick.id).addEventListener('click',()=>perform('train',trick.id));
  globalThis.PuppyActivityUI=Object.freeze({open,render,perform});
  render();
})();
