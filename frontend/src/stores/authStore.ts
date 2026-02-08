import { create } from 'zustand'
import {
  User as FirebaseUser,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { auth, db, googleProvider } from '@/lib/firebase'
import type { User } from '@shared/types'

interface AuthState {
  user: FirebaseUser | null
  userProfile: User | null
  isLoading: boolean
  isAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  initialize: () => () => void
}

// メールアドレスからドメインを抽出
function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || ''
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userProfile: null,
  isLoading: true,
  isAdmin: false,

  signIn: async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error('Sign in error:', error)
      throw error
    }
  },

  signOut: async () => {
    try {
      await firebaseSignOut(auth)
      set({ user: null, userProfile: null, isAdmin: false })
    } catch (error) {
      console.error('Sign out error:', error)
      throw error
    }
  },

  initialize: () => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userEmail = firebaseUser.email || ''
        const userDomain = extractDomain(userEmail)

        // 1. usersコレクションをチェック（既存ユーザー）
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))

        if (userDoc.exists()) {
          // 既存ユーザー → そのままログイン
          const userProfile = userDoc.data() as User
          set({
            user: firebaseUser,
            userProfile,
            isAdmin: userProfile.role === 'admin',
            isLoading: false,
          })
          return
        }

        // 2. 許可ドメインをチェック
        const authSettingsDoc = await getDoc(doc(db, 'settings', 'auth'))
        const allowedDomains: string[] = authSettingsDoc.exists()
          ? (authSettingsDoc.data()?.allowedDomains || [])
          : []

        if (allowedDomains.length > 0 && allowedDomains.includes(userDomain)) {
          // 許可ドメイン → 自動登録
          const newUserProfile: User = {
            uid: firebaseUser.uid,
            email: userEmail,
            displayName: firebaseUser.displayName || userEmail.split('@')[0]!,
            role: 'user',
            createdAt: Timestamp.now(),
            lastLoginAt: Timestamp.now(),
          }

          await setDoc(doc(db, 'users', firebaseUser.uid), {
            ...newUserProfile,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          })

          console.log('User auto-registered via domain allowlist:', userEmail)
          set({
            user: firebaseUser,
            userProfile: newUserProfile,
            isAdmin: false,
            isLoading: false,
          })
          return
        }

        // 3. どちらにも該当しない → 拒否
        console.warn('User not authorized:', userEmail)
        await firebaseSignOut(auth)
        set({ user: null, userProfile: null, isAdmin: false, isLoading: false })
      } else {
        set({ user: null, userProfile: null, isAdmin: false, isLoading: false })
      }
    })

    return unsubscribe
  },
}))
