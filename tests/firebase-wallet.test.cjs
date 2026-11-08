const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createFirebaseMock() {
  const profilePath = 'artifacts/kuromi-study-default/public/data/profiles/마리';
  const profile = { points: 120 };
  const receipts = new Map();
  const ownership = new Map();
  const snapshots = [];
  const appConfig = [];
  const appSdk = { initializeApp(config, name) { appConfig.push({ config, name }); return { name }; } };
  const auth = { currentUser: null };
  class GoogleAuthProvider {}
  const authSdk = {
    GoogleAuthProvider,
    getAuth() { return auth; },
    async signInWithRedirect(target) { target.currentUser = { uid: 'owner', isAnonymous: false, providerData: [{ providerId: 'google.com' }] }; },
    async getRedirectResult(target) { return target.currentUser ? { user: target.currentUser } : null; },
    async signOut(target) { target.currentUser = null; }
  };
  const firestoreSdk = {
    getFirestore() { return {}; },
    doc(parent, ...parts) { return { path: [parent?.path, ...parts.map(part => typeof part === 'string' ? part : part.path)].filter(Boolean).join('/') }; },
    async getDoc(ref) {
      if (ref.path === profilePath) return { exists: () => true, data: () => ({ ...profile }) };
      return { exists: () => false, data: () => ({}) };
    },
    onSnapshot(ref, next) {
      snapshots.push(ref.path);
      next({ exists: () => ref.path === profilePath, data: () => ({ ...profile }) });
      return () => {};
    }
  };
  const functionsSdk = {
    getFunctions(_app, region) { assert.equal(region, 'asia-northeast3'); return { region }; },
    httpsCallable(_functions, name) {
      return async data => {
        if (name === 'purchasePuppyItem') {
          const catalogs = {
            snack: { milk: 30, cookie: 50, meat: 100 },
            toy: { tennis: 100, bone: 150, rope: 200, squeaky: 250, ball: 300, bear: 350, disc: 450, octopus: 550, bubbles: 650, nosework: 900 }
          };
          const price = catalogs[data.kind]?.[data.itemId];
          if (!price) throw Object.assign(new Error('invalid'), { code: 'functions/invalid-argument' });
          const receiptPath = profilePath + '/puppyGamePurchases/' + data.requestId;
          if (receipts.has(receiptPath)) return { data: { ok: true, duplicate: true, balance: profile.points } };
          const ownershipPath = profilePath + '/puppyGameOwnership/' + data.itemId;
          if (data.kind === 'toy' && ownership.has(ownershipPath)) return { data: { ok: false, reason: 'already-owned' } };
          if (profile.points < price) return { data: { ok: false, reason: 'insufficient-cash' } };
          profile.points -= price;
          const receipt = { requestId: data.requestId, kind: data.kind, itemId: data.itemId, amount: price, at: new Date().toISOString() };
          receipts.set(receiptPath, receipt);
          if (data.kind === 'toy') ownership.set(ownershipPath, receipt);
          return { data: { ok: true, balance: profile.points, receipt } };
        }
        if (name === 'listPuppyPurchases') return { data: { purchases: [...receipts.values()] } };
        throw new Error('unexpected callable');
      };
    }
  };
  return { profilePath, profile, receipts, ownership, snapshots, appConfig, loader: async () => [appSdk, authSdk, firestoreSdk, functionsSdk] };
}

async function bootWallet() {
  const localStorage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); }
  };
  const firebase = createFirebaseMock();
  const events = {};
  const window = {
    __PUPPY_WALLET_TESTING__: true,
    PuppyWalletSdkLoader: firebase.loader,
    addEventListener(name, callback) { events[name] = callback; },
    dispatchEvent(event) { events[event.type]?.(event); }
  };
  class Event { constructor(type) { this.type = type; } }
  const context = vm.createContext({ window, localStorage, Event, console: { error() {} } });
  vm.runInContext(fs.readFileSync(require.resolve('../firebase-wallet.js'), 'utf8'), context);
  assert(window.PuppyWallet, 'wallet should initialize');
  return { wallet: window.PuppyWallet, firebase, localStorage };
}

test('Google 로그인 후 이마리의 마리 프로필 하나만 사용하고 서버 영수증으로 중복 차감을 방지한다', async () => {
  const { wallet, firebase } = await bootWallet();
  const linked = await wallet.connect('우리딸');
  assert.equal(linked.ok, true);
  assert.equal(wallet.snapshot().learner, '마리');
  assert.equal(firebase.appConfig[0].config.projectId, 'kuromi-app');
  assert(firebase.snapshots.every(path => path === firebase.profilePath));

  const first = await wallet.spend(30, 'snack-order-1', 'snack', 'milk');
  assert.equal(first.ok, true);
  assert.equal(firebase.profile.points, 90);
  assert.equal(firebase.receipts.get(firebase.profilePath + '/puppyGamePurchases/snack-order-1').amount, 30);

  const retry = await wallet.spend(30, 'snack-order-1', 'snack', 'milk');
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(firebase.profile.points, 90);
  assert.equal(firebase.receipts.size, 1);
});

test('클라이언트 가격은 신뢰하지 않고 장난감 소유 기록은 1회만 생성한다', async () => {
  const { wallet, firebase } = await bootWallet();
  await wallet.connect();
  const first = await wallet.spend(100, 'toy-order-1', 'toy', 'tennis');
  const second = await wallet.spend(100, 'toy-order-2', 'toy', 'tennis');
  assert.equal(first.ok, true);
  assert.equal(second.reason, 'already-owned');
  assert.equal(firebase.profile.points, 20);
  assert.equal(firebase.ownership.size, 1);
});
