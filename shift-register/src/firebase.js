import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCfVHJbS1KFIFUY0SQwq6ICq1iU5XgF20o",
  authDomain: "register-work-d87d6.firebaseapp.com",
  databaseURL: "https://register-work-d87d6-default-rtdb.firebaseio.com",
  projectId: "register-work-d87d6",
  storageBucket: "register-work-d87d6.firebasestorage.app",
  messagingSenderId: "960862126080",
  appId: "1:960862126080:web:1cd9f6e2386cbc1778d8e5",
  measurementId: "G-GBYYH4600T"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
