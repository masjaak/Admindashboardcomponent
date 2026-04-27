import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyD1IbtZeRumahNgK4JyV5s8wWDFrlTXJqF",
  authDomain: "hcsroomserviceapp.firebaseapp.com",
  projectId: "hcsroomserviceapp",
  storageBucket: "hcsroomserviceapp.firebasestorage.app",
  messagingSenderId: "949808465266",
  appId: "1:949008465266:web:4609a0f650a8f9106071eb",
  measurementId: "G-VJ1MXRJ60X"
};

// Initialize Firebase (Singleton pattern to prevent re-initialization errors)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Analytics only in browser environment
let analytics;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch((err) => {
    console.warn("Firebase Analytics not supported:", err);
  });
}

// Export services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, "asia-southeast2");
