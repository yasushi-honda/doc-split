import { create } from 'zustand'
import {
  User as FirebaseUser,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
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
        // ホワイトリストチェック
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))

        if (userDoc.exists()) {
          const userProfile = userDoc.data() as User
          set({
            user: firebaseUser,
            userProfile,
            isAdmin: userProfile.role === 'admin',
            isLoading: false,
          })
        } else {
          // ホワイトリストに未登録
          console.warn('User not whitelisted:', firebaseUser.email)
          await firebaseSignOut(auth)
          set({ user: null, userProfile: null, isAdmin: false, isLoading: false })
        }
      } else {
        set({ user: null, userProfile: null, isAdmin: false, isLoading: false })
      }
    })

    return unsubscribe
  },
}))
