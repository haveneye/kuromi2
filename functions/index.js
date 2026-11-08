'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

initializeApp();
const db = getFirestore();
const REGION = 'asia-northeast3';
const APP_ID = 'kuromi-study-default';
const PROFILE_NAME = '마리';
const puppyOwnerUid = defineSecret('PUPPY_GAME_OWNER_UID');
const CATALOG = Object.freeze({
  snack: Object.freeze({ milk: 30, cookie: 50, meat: 100 }),
  toy: Object.freeze({ tennis: 100, bone: 150, rope: 200, squeaky: 250, ball: 300, bear: 350, disc: 450, octopus: 550, bubbles: 650, nosework: 900 })
});

function refs() {
  const dataRoot = db.collection('artifacts').doc(APP_ID).collection('public').doc('data');
  return {
    profile: dataRoot.collection('profiles').doc(PROFILE_NAME)
  };
}

function requireGoogleOwner(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Google 로그인이 필요합니다.');
  if (request.auth.token.firebase?.sign_in_provider !== 'google.com') {
    throw new HttpsError('permission-denied', 'Google 계정으로 연결해 주세요.');
  }
  if (!puppyOwnerUid.value() || request.auth.uid !== puppyOwnerUid.value()) {
    throw new HttpsError('permission-denied', '게임 소유자 계정이 아닙니다.');
  }
}

exports.purchasePuppyItem = onCall({ region: REGION, secrets: [puppyOwnerUid] }, async request => {
  requireGoogleOwner(request);
  const { profile } = refs();

  const { kind, itemId, requestId } = request.data || {};
  const price = CATALOG[kind]?.[itemId];
  if (!price || typeof requestId !== 'string' || !/^[\w-]{1,96}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', '상품 또는 구매 요청을 확인해 주세요.');
  }
  const receipt = profile.collection('puppyGamePurchases').doc(requestId);
  const ownership = kind === 'toy' ? profile.collection('puppyGameOwnership').doc(itemId) : null;

  return db.runTransaction(async transaction => {
    const [profileSnapshot, receiptSnapshot, ownershipSnapshot] = await Promise.all([
      transaction.get(profile), transaction.get(receipt), ownership ? transaction.get(ownership) : Promise.resolve(null)
    ]);
    if (receiptSnapshot.exists) {
      const saved = receiptSnapshot.data();
      if (saved.kind !== kind || saved.itemId !== itemId) throw new HttpsError('already-exists', '요청 번호가 이미 다른 구매에 사용됐어요.');
      return { ok: true, duplicate: true, balance: profileSnapshot.get('points'), receipt: saved };
    }
    if (ownershipSnapshot?.exists) return { ok: false, reason: 'already-owned' };
    if (!profileSnapshot.exists) throw new HttpsError('not-found', '마리 프로필을 찾지 못했어요.');
    const current = profileSnapshot.get('points');
    if (!Number.isSafeInteger(current) || current < 0) throw new HttpsError('failed-precondition', '학습캐시 잔액 정보를 확인할 수 없어요.');
    if (current < price) return { ok: false, reason: 'insufficient-cash' };

    const balance = current - price;
    const savedReceipt = {
      requestId, kind, itemId, amount: price, at: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.update(profile, { points: balance });
    transaction.create(receipt, savedReceipt);
    if (ownership) transaction.create(ownership, { kind, itemId, amount: price, requestId, at: savedReceipt.at });
    return { ok: true, balance, receipt: { ...savedReceipt, createdAt: null } };
  });
});

exports.listPuppyPurchases = onCall({ region: REGION, secrets: [puppyOwnerUid] }, async request => {
  requireGoogleOwner(request);
  const { profile } = refs();
  const snapshot = await profile.collection('puppyGamePurchases').get();
  const purchases = snapshot.docs.map(doc => {
    const item = doc.data();
    return { requestId: item.requestId, kind: item.kind, itemId: item.itemId, amount: item.amount, at: item.at };
  });
  return { purchases };
});

exports.__test = Object.freeze({ CATALOG, requireGoogleOwner });
