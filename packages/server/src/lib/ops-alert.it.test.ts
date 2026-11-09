import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from './prisma.js';
import { opsAlertRecipients, hasOpsRecipients } from './ops-alert.js';

describe('получатели оповещений', () => {
  const saved = { ids: process.env.OPS_ALERT_USER_IDS, emails: process.env.OPS_ALERT_EMAILS };
  afterEach(() => {
    process.env.OPS_ALERT_USER_IDS = saved.ids;
    process.env.OPS_ALERT_EMAILS = saved.emails;
  });

  it('почта аккаунта → его id (регистр не важен), плюс явные id, без повторов', async () => {
    const u = await prisma.user.create({ data: { email: `owner-${Date.now()}@t.io`, name: 'В', passwordHash: 'x' } });
    process.env.OPS_ALERT_EMAILS = ` ${u.email.toUpperCase()} , nobody@t.io`;
    process.env.OPS_ALERT_USER_IDS = `${u.id},other-id`;
    expect(hasOpsRecipients()).toBe(true);
    expect((await opsAlertRecipients()).sort()).toEqual([u.id, 'other-id'].sort());
  });

  it('ничего не задано — никому', async () => {
    process.env.OPS_ALERT_EMAILS = '';
    process.env.OPS_ALERT_USER_IDS = '';
    expect(hasOpsRecipients()).toBe(false);
    expect(await opsAlertRecipients()).toEqual([]);
  });
});
