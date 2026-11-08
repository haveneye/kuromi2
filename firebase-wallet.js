// Shared learning-cash wallet for the single family learning profile selected by the user.
// Puppy purchases always target the existing Mari (마리) profile; no child picker is exposed.
(async function () {
  'use strict';
  const LINK_KEY = 'our-puppy:learning-wallet-profile';
  const APP_ID = 'kuromi-study-default';
  const LEARNER_PROFILE = '마리';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBV_rnTIqxLquQAJ2i14S-Lin2y0bCIF3Q',
    authDomain: 'kuromi-app.firebaseapp.com',
    projectId: 'kuromi-app',
    storageBucket: 'kuromi-app.firebasestorage.app',
    messagingSenderId: '713556925410',
    appId: '1:713556925410:web:76ef2b7dcff8138ad637bb'
  };
  let db;
  let auth;
  let learner = '';
  let balance = null;
  let stopWatch = null;
  let ready = false;
  let firestoreSdk;
  let authSdk;
  let functionsSdk;
  let functions;
  const listeners = new Set();

  function emit() { for (const listener of listeners) listener(snapshot()); }
  function snapshot() { return { connected: !!learner, learner, balance }; }
  function profileRef(doc, name) {
    return doc(db, 'artifacts', APP_ID, 'public', 'data', 'profiles', name);
  }
  async function ensureFirebase() {
    if (ready) return;
    const useTestSdk = window.__PUPPY_WALLET_TESTING__ === true && typeof window.PuppyWalletSdkLoader === 'function';
    const [appSdk, loadedAuthSdk, dbSdk, loadedFunctionsSdk] = useTestSdk
      ? await window.PuppyWalletSdkLoader()
      : await Promise.all([
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js'),
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'),
          import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js')
        ]);
    const app = appSdk.initializeApp(FIREBASE_CONFIG, 'puppy-learning-wallet');
    db = dbSdk.getFirestore(app);
    authSdk = loadedAuthSdk;
    functionsSdk = loadedFunctionsSdk;
    auth = authSdk.getAuth(app);
    if (typeof auth.authStateReady === 'function') await auth.authStateReady();
    functions = functionsSdk.getFunctions(app, 'asia-northeast3');
    firestoreSdk = dbSdk;
    ready = true;
  }
  function isGoogleUser(user) {
    return !!user && !user.isAnonymous && Array.isArray(user.providerData) && user.providerData.some(provider => provider.providerId === 'google.com');
  }
  function watchProfile(firestore) {
    if (stopWatch) stopWatch();
    stopWatch = firestore.onSnapshot(profileRef(firestore.doc, learner), snap => {
      if (!snap.exists()) { learner = ''; balance = null; localStorage.removeItem(LINK_KEY); }
      else {
        const points = snap.data().points;
        balance = Number.isSafeInteger(points) && points >= 0 ? points : null;
      }
      emit();
    }, error => {
      balance = null;
      emit();
      console.error('학습캐시 동기화 실패:', error);
    });
  }
  async function connect() {
    await ensureFirebase();
    if (!isGoogleUser(auth.currentUser)) {
      if (auth.currentUser) await authSdk.signOut(auth);
      // Redirect works on mobile browsers and doesn't depend on a popup surviving
      // the asynchronous Firebase SDK initialization above.
      localStorage.setItem(LINK_KEY, LEARNER_PROFILE);
      await authSdk.signInWithRedirect(auth, new authSdk.GoogleAuthProvider());
      if (!isGoogleUser(auth.currentUser)) return { ok: false, reason: 'redirecting' };
    }
    if (!isGoogleUser(auth.currentUser)) return { ok: false, reason: 'google-login-required' };
    const firestore = firestoreSdk;
    const ref = profileRef(firestore.doc, LEARNER_PROFILE);
    const profile = await firestore.getDoc(ref);
    if (!profile.exists()) return { ok: false, reason: 'profile-not-found' };
    learner = LEARNER_PROFILE;
    localStorage.setItem(LINK_KEY, LEARNER_PROFILE);
    balance = Number.isSafeInteger(profile.data().points) && profile.data().points >= 0 ? profile.data().points : null;
    watchProfile(firestore);
    emit();
    return { ok: true, balance };
  }
  async function restore() {
    try {
      await ensureFirebase();
      if (typeof authSdk.getRedirectResult === 'function') await authSdk.getRedirectResult(auth);
      if (!isGoogleUser(auth.currentUser) || localStorage.getItem(LINK_KEY) !== LEARNER_PROFILE) return snapshot();
      const name = LEARNER_PROFILE;
      const firestore = firestoreSdk;
      const ref = profileRef(firestore.doc, name);
      const profile = await firestore.getDoc(ref);
      if (!profile.exists()) { localStorage.removeItem(LINK_KEY); return snapshot(); }
      learner = name;
      balance = Number.isSafeInteger(profile.data().points) && profile.data().points >= 0 ? profile.data().points : null;
      watchProfile(firestore);
      emit();
    } catch (error) {
      balance = null;
      emit();
      console.error('저장된 학습캐시 연결을 복원하지 못했어요:', error);
    }
    return snapshot();
  }
  function disconnect() {
    if (stopWatch) stopWatch();
    stopWatch = null;
    learner = '';
    balance = null;
    localStorage.removeItem(LINK_KEY);
    if (auth && authSdk) authSdk.signOut(auth).catch(error => console.error('Google 연결을 해제하지 못했어요:', error));
    emit();
  }
  async function spend(amount, requestId, kind, itemId) {
    if (!learner || !Number.isSafeInteger(balance)) return { ok: false, reason: 'not-connected' };
    if (!Number.isSafeInteger(amount) || amount < 1 || typeof requestId !== 'string' || !/^[\w-]{1,96}$/.test(requestId)) return { ok: false, reason: 'invalid-request' };
    if (!isGoogleUser(auth.currentUser)) return { ok: false, reason: 'google-login-required' };
    try {
      const callable = functionsSdk.httpsCallable(functions, 'purchasePuppyItem');
      const response = await callable({ amount, requestId, kind, itemId });
      const result = response.data;
      if (Number.isSafeInteger(result.balance)) balance = result.balance;
      emit();
      return result;
    } catch (error) {
      const code = String(error.code || '').replace(/^functions\//, '');
      if (['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found', 'resource-exhausted'].includes(code)) return { ok: false, reason: code };
      throw error;
    }
  }
  async function purchases() {
    if (!learner) return [];
    await ensureFirebase();
    if (!isGoogleUser(auth.currentUser)) return [];
    const callable = functionsSdk.httpsCallable(functions, 'listPuppyPurchases');
    const response = await callable({});
    return Array.isArray(response.data?.purchases) ? response.data.purchases : [];
  }
  window.PuppyWallet = Object.freeze({ snapshot, connect, restore, disconnect, spend, purchases, subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); } });
  window.dispatchEvent(new Event('puppywalletready'));
  restore().then(() => emit());
})();
