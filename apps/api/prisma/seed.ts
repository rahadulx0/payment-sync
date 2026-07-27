// Idempotent, environment-aware seed (workplan/02 §4.5).
// Always: provider profiles, inactive parser-rule placeholders, the admin user.
// Dev/test only: a fixed dev company with both key types, a device, and a few
// sms_logs / payment_requests. Refuses dev fixtures under NODE_ENV=production.
import { pathToFileURL } from 'node:url';

import { hash } from '@node-rs/argon2';
import { Provider } from '@paysync/shared';
import { PrismaClient } from '@prisma/client';

// @node-rs/argon2 defaults to Argon2id; keep the OWASP-ish cost params (architecture §13.2).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const PROVIDER_PROFILES = [
  {
    provider: Provider.BKASH,
    display_name: 'bKash',
    sender_addresses: ['bKash', 'BKASH', '16247'],
    msisdn_prefixes: ['013', '014', '015', '016', '017', '018', '019'],
  },
  {
    provider: Provider.NAGAD,
    display_name: 'Nagad',
    sender_addresses: ['NAGAD', 'Nagad', '16167'],
    msisdn_prefixes: ['013', '014', '015', '016', '017', '018', '019'],
  },
  {
    provider: Provider.UPAY,
    display_name: 'Upay',
    sender_addresses: ['upay', 'UPAY', '16268'],
    msisdn_prefixes: ['013', '014', '015', '016', '017', '018', '019'],
  },
];

export interface SeedOptions {
  isProd: boolean;
  adminEmail: string;
  adminPassword: string;
  seedDev: boolean;
}

export async function seed(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  for (const p of PROVIDER_PROFILES) {
    await prisma.providerProfile.upsert({
      where: { provider: p.provider },
      update: {
        display_name: p.display_name,
        sender_addresses: p.sender_addresses,
        msisdn_prefixes: p.msisdn_prefixes,
        is_active: true,
      },
      create: { ...p, is_active: true },
    });
    await prisma.parserRule.upsert({
      where: { provider_version: { provider: p.provider, version: 0 } },
      update: {},
      create: { provider: p.provider, version: 0, rule: {}, is_active: false },
    });
  }

  await prisma.adminUser.upsert({
    where: { email: opts.adminEmail },
    update: {},
    create: {
      email: opts.adminEmail,
      password_hash: await hash(opts.adminPassword, ARGON),
      recovery_codes_hash: [],
    },
  });

  if (!opts.isProd && opts.seedDev) {
    await seedDevCompany(prisma);
  }
}

const DEV_INSTALL_ID = '00000000-0000-7000-8000-000000000001';

async function seedDevCompany(prisma: PrismaClient): Promise<void> {
  const company = await prisma.company.upsert({
    where: { company_code: 'COMP-DEV-001' },
    update: {},
    create: {
      company_code: 'COMP-DEV-001',
      name: 'Dev Test Company',
      contact_email: 'dev@example.com',
      status: 'ACTIVE',
      default_callback_url: 'https://client.example.com/webhook',
      settings: { create: {} },
    },
  });

  const keyCount = await prisma.apiKey.count({ where: { company_id: company.id } });
  if (keyCount === 0) {
    // Fixed dev-only plaintexts — documented, never used in production.
    await prisma.apiKey.create({
      data: {
        company_id: company.id,
        key_type: 'SERVER',
        prefix: 'psk_test_',
        key_hash: await hash('psk_test_devserverkey0000000000000000', ARGON),
        label: 'dev server key',
        scopes: ['payments:write', 'payments:read'],
      },
    });
    await prisma.apiKey.create({
      data: {
        company_id: company.id,
        key_type: 'DEVICE_ENROLL',
        prefix: 'pde_test_',
        key_hash: await hash('pde_test_devenrollkey0000000000000000', ARGON),
        label: 'dev enrol key',
        scopes: ['device:enroll'],
      },
    });
  }

  await prisma.device.upsert({
    where: { install_id: DEV_INSTALL_ID },
    update: {},
    create: {
      company_id: company.id,
      device_name: 'Dev Phone',
      install_id: DEV_INSTALL_ID,
      manufacturer: 'Xiaomi',
      model: 'Redmi Note 12',
      android_version: '14',
      app_version: '1.0.0',
      wallet_msisdn: '+8801712345678',
      token_hash: await hash('pdt_test_devtoken00000000000000000000', ARGON),
    },
  });

  const orderCount = await prisma.paymentRequest.count({ where: { company_id: company.id } });
  if (orderCount === 0) {
    await prisma.paymentRequest.create({
      data: {
        company_id: company.id,
        order_id: 'ORD-DEV-1',
        transaction_id: '8A7BCD1234',
        expected_amount: '1250.00',
        callback_url: 'https://client.example.com/webhook',
        match_mode: 'EXACT',
        amount_tolerance: '0.00',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.paymentRequest.create({
      data: {
        company_id: company.id,
        order_id: 'ORD-DEV-2',
        expected_amount: '500.00',
        expected_provider: 'BKASH',
        callback_url: 'https://client.example.com/webhook',
        match_mode: 'HEURISTIC',
        amount_tolerance: '0.00',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const device = await prisma.device.findUnique({ where: { install_id: DEV_INSTALL_ID } });
    await prisma.smsLog.create({
      data: {
        company_id: company.id,
        device_id: device?.id ?? null,
        client_msg_hash: 'd'.repeat(64),
        content_hash: 'e'.repeat(64),
        sms_address: 'bKash',
        provider: 'BKASH',
        raw_message: 'Cash In Tk 1,250.00 from 017XXXXXXXX. TrxID 8A7BCD1234 at 27/07/2026 10:15',
        transaction_id: '8A7BCD1234',
        amount: '1250.00',
        sms_timestamp: new Date(),
        device_received_at: new Date(),
        parse_status: 'PARSED',
        parse_confidence: '1.00',
        upload_source: 'REALTIME',
      },
    });
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seed(prisma, {
      isProd: process.env['NODE_ENV'] === 'production',
      adminEmail: process.env['SEED_ADMIN_EMAIL'] ?? 'admin@example.com',
      adminPassword: process.env['SEED_ADMIN_PASSWORD'] ?? 'ChangeMe!Dev123',
      seedDev: process.env['SEED_DEV'] !== 'false',
    });
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
