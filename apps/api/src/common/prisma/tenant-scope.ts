import type { PrismaClient } from '@prisma/client';

// Tables that carry company_id and must be tenant-isolated at the client layer,
// so a bug in a `where` clause can never leak across tenants (architecture §13.1 T5).
const TENANT_MODELS = new Set([
  'SmsLog',
  'PaymentRequest',
  'VerifiedTransaction',
  'WebhookEvent',
  'Device',
  'ApiKey',
  'MatchReview',
  'MatchAttempt',
]);

const SCOPED_READS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

interface MutableArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * A Prisma client bound to one company: every scoped read/aggregate is filtered
 * to that company_id and every create stamps it. Repositories receive this
 * client so tenant isolation does not depend on per-query discipline. Point
 * writes (findUnique/update/delete by unique key) are intentionally NOT rewritten
 * — callers use the *Many variants or a composite key that includes company_id.
 */
export function tenantScopedClient(base: PrismaClient, companyId: string) {
  return base.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args as unknown as MutableArgs;
          if (SCOPED_READS.has(operation)) {
            a.where = { AND: [{ company_id: companyId }, a.where ?? {}] };
          } else if (operation === 'create') {
            a.data = { ...(a.data as Record<string, unknown>), company_id: companyId };
          } else if (operation === 'createMany') {
            const d = a.data;
            a.data = Array.isArray(d)
              ? d.map((x) => ({ ...x, company_id: companyId }))
              : { ...(d ?? {}), company_id: companyId };
          }
          return query(args);
        },
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof tenantScopedClient>;
