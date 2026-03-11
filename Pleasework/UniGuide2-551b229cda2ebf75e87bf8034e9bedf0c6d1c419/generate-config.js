const fs = require('fs');

function clean(val) {
  if (!val) return '';
  return val.replace(/^["']|["']$/g, '').trim();
}

const config = {
  apiKey:            clean(process.env.FIREBASE_API_KEY),
  authDomain:        clean(process.env.FIREBASE_AUTH_DOMAIN),
  projectId:         clean(process.env.FIREBASE_PROJECT_ID),
  storageBucket:     clean(process.env.FIREBASE_STORAGE_BUCKET),
  messagingSenderId: clean(process.env.FIREBASE_MESSAGING_SENDER_ID),
  appId:             clean(process.env.FIREBASE_APP_ID),
};

const configured = !!config.apiKey;

const output = `// AUTO-GENERATED — do not edit manually. Run generate-config.js to regenerate.
const FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};
const FIREBASE_CONFIGURED = ${configured};
`;

fs.writeFileSync('firebase-config.js', output);
console.log('firebase-config.js written. Firebase configured:', configured);
