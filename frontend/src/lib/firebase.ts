import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { checkDevProjectGuard } from './devProjectGuard'

// Firebase設定（.envから読み込み）
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

checkDevProjectGuard(firebaseConfig.projectId, import.meta.env.DEV)

// Firebase初期化
export const app = initializeApp(firebaseConfig)

// 各サービスをエクスポート
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'asia-northeast1')
export const googleProvider = new GoogleAuthProvider()

// E2Eテスト用（page.evaluate内でベアモジュール指定子が使えないため再エクスポート）
export { signInWithEmailAndPassword }

// Emulator接続（E2Eテスト用）
const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'

if (useEmulator) {
  console.log('🔧 Firebase Emulator に接続中...')
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, 'localhost', 8085)
  connectStorageEmulator(storage, 'localhost', 9199)
  connectFunctionsEmulator(functions, 'localhost', 5001)
}

export default app
