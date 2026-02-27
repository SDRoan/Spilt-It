import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase code.");

const expenseBaseSchema = z.object({
  description: z.string().trim().min(1).max(120),
  date: isoDateSchema,
  paidBy: uuidSchema,
  currencyCode: currencySchema,
  notes: z.string().trim().max(500).optional(),
});

const equalPayloadSchema = expenseBaseSchema.extend({
  mode: z.literal("equal"),
  totalCents: z.number().int().positive(),
  participants: z.array(uuidSchema).min(1),
});

const exactPayloadSchema = expenseBaseSchema.extend({
  mode: z.literal("exact"),
  totalCents: z.number().int().positive(),
  allocations: z
    .array(
      z.object({
        memberId: uuidSchema,
        amountCents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

const percentPayloadSchema = expenseBaseSchema.extend({
  mode: z.literal("percent"),
  totalCents: z.number().int().positive(),
  allocations: z
    .array(
      z.object({
        memberId: uuidSchema,
        percent: z.number().nonnegative(),
      }),
    )
    .min(1),
});

const sharesPayloadSchema = expenseBaseSchema.extend({
  mode: z.literal("shares"),
  totalCents: z.number().int().positive(),
  allocations: z
    .array(
      z.object({
        memberId: uuidSchema,
        shares: z.number().nonnegative(),
      }),
    )
    .min(1),
});

const itemizedPayloadSchema = expenseBaseSchema.extend({
  mode: z.literal("itemized"),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        amountCents: z.number().int().positive(),
        memberIds: z.array(uuidSchema).min(1),
      }),
    )
    .min(1),
});

export const expensePayloadSchema = z.discriminatedUnion("mode", [
  equalPayloadSchema,
  exactPayloadSchema,
  percentPayloadSchema,
  sharesPayloadSchema,
  itemizedPayloadSchema,
]);

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  currencyCode: currencySchema,
});

export const createInviteSchema = z.object({
  groupId: uuidSchema,
});

export const paymentSchema = z
  .object({
    groupId: uuidSchema,
    fromMemberId: uuidSchema,
    toMemberId: uuidSchema,
    amountCents: z.number().int().positive(),
    paymentDate: isoDateSchema,
    note: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.fromMemberId !== value.toMemberId, {
    message: "Payer and receiver must be different members.",
    path: ["toMemberId"],
  });

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  next: z.string().trim().optional(),
});
