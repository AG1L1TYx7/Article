/**
 * Prints a fresh VAPID key pair for Web Push, ready to paste into .env.
 *
 *   npm run push:keys
 *
 * Run it once per deployment. The private key is a secret: it proves to
 * Google's, Apple's and Mozilla's push services that a message really
 * came from this site. Generating a new pair later orphans every
 * existing subscription — readers would have to turn alerts on again —
 * so keep it with the same care as AUTH_SECRET.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`VAPID_PUBLIC_KEY="${publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:you@yourdomain.com"`);
