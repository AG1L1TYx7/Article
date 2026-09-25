import { appendFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Text messages, the same way email works here: a real provider when its
 * keys are present, a local outbox when they are not.
 *
 * Twilio is the provider, driven through its REST API with fetch so no
 * SDK is pulled in for one call. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * and TWILIO_FROM (an E.164 number or a messaging service SID). Without
 * them every message is written to .sms-dev-outbox.log, which is how the
 * phone-verification flow is exercised locally and by the e2e suite.
 * That file is gitignored and stripped from the cPanel bundle.
 */
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM;

export const smsConfigured = !!(SID && TOKEN && FROM);

const DEV_OUTBOX_PATH = join(process.cwd(), ".sms-dev-outbox.log");

export async function sendSms({ to, body }: { to: string; body: string }): Promise<void> {
  if (!smsConfigured) {
    console.log(`\n[sms:dev] would send to ${to}\n${body}\n`);
    appendFileSync(DEV_OUTBOX_PATH, JSON.stringify({ to, body, sentAt: new Date().toISOString() }) + "\n");
    return;
  }

  const params = new URLSearchParams({ To: to, Body: body });
  if (FROM!.startsWith("MG")) params.set("MessagingServiceSid", FROM!);
  else params.set("From", FROM!);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    // The body names the reason (unverified trial number, bad format);
    // the person on the other end gets a plain "could not send".
    throw new Error(`Twilio refused the message: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

export function phoneCodeMessage(code: string, siteName: string): string {
  return `${code} is your ${siteName} verification code. It expires in 10 minutes. If you did not ask for it, ignore this message.`;
}
