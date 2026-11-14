import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import nodemailer from 'nodemailer';
import Stripe from 'stripe';
import { createCloud } from './service.mjs';
import { abuseLimits } from './abuse.mjs';

export function configuredCloud(env = process.env) {
  const origin = new URL(env.FILOW_CLOUD_ORIGIN || 'http://127.0.0.1:4780').origin;
  const local = ['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname);
  if (!local && !origin.startsWith('https:')) throw new Error('Cloud origin must use HTTPS');
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters');
  if (!env.FILOW_CLOUD_DB || !path.isAbsolute(env.FILOW_CLOUD_DB)) throw new Error('Set FILOW_CLOUD_DB to an absolute persistent database path');
  if (process.platform === 'win32' && /^c:/i.test(env.FILOW_CLOUD_DB)) throw new Error('Store the account database on E: or G:, not C:');
  if (!env.SMTP_URL || !env.MAIL_FROM) throw new Error('Set SMTP_URL and MAIL_FROM for sign-in codes');
  mkdirSync(path.dirname(env.FILOW_CLOUD_DB),{recursive:true});
  const database = new Database(env.FILOW_CLOUD_DB);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const mail = nodemailer.createTransport(env.SMTP_URL);
  const hasBilling = [env.STRIPE_SECRET_KEY,env.STRIPE_WEBHOOK_SECRET,env.STRIPE_PRICE_ID].filter(Boolean).length;
  if (hasBilling && hasBilling !== 3) throw new Error('Configure all three Stripe values or leave all empty');
  if (hasBilling && !env.STRIPE_SECRET_KEY.startsWith('sk_test_') && env.FILOW_LIVE_BILLING !== '1') throw new Error('Live billing is disabled. Use Stripe test credentials.');
  const service = createCloud({ database, origin, liveBilling: env.FILOW_LIVE_BILLING === '1', secret: env.BETTER_AUTH_SECRET,
    limits: abuseLimits(env),
    stripe: hasBilling ? new Stripe(env.STRIPE_SECRET_KEY) : undefined,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET, priceId: env.STRIPE_PRICE_ID,
    sendOTP: ({ email, otp }) => mail.sendMail({ from: env.MAIL_FROM, to: email, subject: 'Your Filo sign-in code',
      text: `Your Filo code is ${otp}. It expires in 10 minutes. If you did not request it, ignore this email.` }),
  });
  return { ...service, database, origin };
}
