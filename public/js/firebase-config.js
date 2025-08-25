// Firebase Configuration
// This file contains the Firebase configuration for the application
// For production, consider using environment-specific configurations

const firebaseConfig = {
    apiKey:             "AIzaSyCZP5Ki4Mt-RnEnqno55KySWBytJ4mITlE",
    authDomain:         "resudemo1.firebaseapp.com",
    projectId:          "resudemo1",
    storageBucket:      "resudemo1.firebasestorage.app",
    messagingSenderId:  "1011283594542",
    appId:              "1:1011283594542:web:78dde51cf9f7335726bebf"
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