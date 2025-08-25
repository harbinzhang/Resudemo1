// Firebase Configuration Example
// Copy this file to firebase-config.js and fill in your Firebase project details
// DO NOT commit firebase-config.js if it contains sensitive information

const firebaseConfig = {
    apiKey:             "YOUR_API_KEY",
    authDomain:         "YOUR_PROJECT_ID.firebaseapp.com",
    projectId:          "YOUR_PROJECT_ID",
    storageBucket:      "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId:  "YOUR_MESSAGING_SENDER_ID",
    appId:              "YOUR_APP_ID"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Connect to emulators when running locally
if (location.hostname === "localhost") {
    auth.useEmulator("http://localhost:9099");
    db.useEmulator("localhost", 8080);
    storage.useEmulator("localhost", 9199);
    console.log("Connected to Firebase emulators");
}

// Export for use in other scripts
window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDB = db;
window.firebaseStorage = storage;