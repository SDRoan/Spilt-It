"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getGroupAndMembers } from "@/lib/db";
import { env, isSupabaseConfigured } from "@/lib/env";
import { parseAmountToCents } from "@/lib/money";
import { computeExpenseSplit } from "@/lib/splits";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGroupSchema,
  displayNameSchema,
  expensePayloadSchema,
  loginSchema,
  paymentSchema,
} from "@/lib/validation";
import type { ExpensePayload } from "@/types/app";

function toDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
}

function normalizeNextPath(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return "/dashboard";
  }

  return value.startsWith("/") ? value : "/dashboard";
}

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

interface ActionState {
  error?: string;
  success?: string;
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured) {
    return {
      error:
        "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    };
  }

  const rawEmail = formData.get("email");
  const rawNext = formData.get("next");

  const parsed = loginSchema.safeParse({
    email: typeof rawEmail === "string" ? rawEmail : "",
    next: typeof rawNext === "string" ? rawNext : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please enter a valid email." };
  }

  const supabase = await createSupabaseServerClient();
  const nextPath = normalizeNextPath(parsed.data.next);
  const callbackUrl = new URL(`${env.siteUrl()}/auth/callback`);
  callbackUrl.searchParams.set("next", nextPath);

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    return { error: error.message };
  }

  return {
    success: "Check your email for a magic login link.",
  };
}

export async function logoutAction(): Promise<void> {
  if (!isSupabaseConfigured) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function updateDisplayNameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser("/dashboard");
  const supabase = await createSupabaseServerClient();

  const rawDisplayName = formData.get("displayName");
  const parsed = displayNameSchema.safeParse({
    displayName: typeof rawDisplayName === "string" ? rawDisplayName : "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid display name." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");

  return { success: "Profile updated." };
}

export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser("/dashboard");
  const supabase = await createSupabaseServerClient();

  const rawName = formData.get("name");
  const rawCurrencyCode = formData.get("currencyCode");

  const parsed = createGroupSchema.safeParse({
    name: typeof rawName === "string" ? rawName : "",
    currencyCode: typeof rawCurrencyCode === "string" ? rawCurrencyCode.toUpperCase() : "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid group data." };
  }

  const { data: groupRow, error: groupError } = await supabase
    .from("groups")
    .insert({
      name: parsed.data.name,
      currency_code: parsed.data.currencyCode,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (groupError) {
    return { error: groupError.message };
  }

  if (!groupRow?.id) {
    return { error: "Could not create group." };
  }

  const groupId = groupRow.id as string;

  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: groupId,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    return { error: memberError.message };
  }

  revalidatePath("/dashboard");

  return { success: "Group created successfully." };
}

export async function createInviteAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const supabase = await createSupabaseServerClient();

  const rawGroupId = formData.get("groupId");
  const groupId = typeof rawGroupId === "string" ? rawGroupId : "";

  if (!groupId) {
    throw new Error("Missing group ID.");
  }

  const token = crypto.randomUUID().replaceAll("-", "");

  const { error } = await supabase.from("invites").insert({
    group_id: groupId,
    token,
    expires_at: toDate(7),
    created_by: user.id,
  });

  assertNoError(error, "Could not create invite");

  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}?invite=${token}`);
}

export async function joinInviteAction(formData: FormData): Promise<void> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const rawToken = formData.get("token");
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  if (!token) {
    throw new Error("Missing invite token.");
  }

  const { data, error } = await supabase.rpc("join_group_with_invite", {
    invite_token: token,
  });

  assertNoError(error, "Could not join group with invite");

  const groupId = data as string;
  revalidatePath("/dashboard");
  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}`);
}

function parseExpensePayloadFromForm(formData: FormData): {
  groupId: string;
  expenseId: string | null;
  payload: ExpensePayload;
} {
  const rawGroupId = formData.get("groupId");
  const rawExpenseId = formData.get("expenseId");
  const rawPayload = formData.get("payload");

  const groupId = typeof rawGroupId === "string" ? rawGroupId : "";
  const expenseId = typeof rawExpenseId === "string" && rawExpenseId.length > 0 ? rawExpenseId : null;

  if (!groupId) {
    throw new Error("Missing group ID.");
  }

  if (typeof rawPayload !== "string") {
    throw new Error("Missing expense payload.");
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(rawPayload);
  } catch {
    throw new Error("Expense payload is not valid JSON.");
  }

  const parsedPayload = expensePayloadSchema.safeParse(payloadJson);

  if (!parsedPayload.success) {
    const reason = parsedPayload.error.issues[0]?.message ?? "Invalid expense payload.";
    throw new Error(reason);
  }

  return {
    groupId,
    expenseId,
    payload: parsedPayload.data,
  };
}

function assertMembersInGroup(memberIds: string[], groupMemberIds: Set<string>): void {
  for (const memberId of memberIds) {
    if (!groupMemberIds.has(memberId)) {
      throw new Error("One or more selected members are not in the group.");
    }
  }
}

export async function saveExpenseAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { groupId, expenseId, payload } = parseExpensePayloadFromForm(formData);

  const { group, members } = await getGroupAndMembers(groupId);
  const groupMemberIds = new Set(members.map((member) => member.userId));

  if (!groupMemberIds.has(payload.paidBy)) {
    throw new Error("Payer must be a member of the group.");
  }

  if (payload.currencyCode !== group.currencyCode) {
    throw new Error(`Group currency is ${group.currencyCode}. Expense currency must match group currency.`);
  }

  let computed = null;

  switch (payload.mode) {
    case "equal":
      assertMembersInGroup(payload.participants, groupMemberIds);
      computed = computeExpenseSplit({
        mode: "equal",
        totalCents: payload.totalCents,
        participants: payload.participants,
      });
      break;

    case "exact":
      assertMembersInGroup(
        payload.allocations.map((entry) => entry.memberId),
        groupMemberIds,
      );
      computed = computeExpenseSplit({
        mode: "exact",
        totalCents: payload.totalCents,
        exactAllocations: payload.allocations,
      });
      break;

    case "percent":
      assertMembersInGroup(
        payload.allocations.map((entry) => entry.memberId),
        groupMemberIds,
      );
      computed = computeExpenseSplit({
        mode: "percent",
        totalCents: payload.totalCents,
        percentAllocations: payload.allocations,
      });
      break;

    case "shares":
      assertMembersInGroup(
        payload.allocations.map((entry) => entry.memberId),
        groupMemberIds,
      );
      computed = computeExpenseSplit({
        mode: "shares",
        totalCents: payload.totalCents,
        shareAllocations: payload.allocations,
      });
      break;

    case "itemized":
      payload.items.forEach((item) => assertMembersInGroup(item.memberIds, groupMemberIds));
      computed = computeExpenseSplit({
        mode: "itemized",
        itemizedItems: payload.items,
      });
      break;

    default:
      throw new Error("Unsupported split mode.");
  }

  const totalCents = computed.totalCents;
  const notes = payload.notes?.trim() || null;

  let savedExpenseId = expenseId;

  if (savedExpenseId) {
    const { error: updateError } = await supabase
      .from("expenses")
      .update({
        description: payload.description,
        expense_date: payload.date,
        paid_by: payload.paidBy,
        currency_code: payload.currencyCode,
        total_cents: totalCents,
        notes,
        split_mode: payload.mode,
        updated_by: user.id,
      })
      .eq("id", savedExpenseId)
      .eq("group_id", groupId);

    assertNoError(updateError, "Could not update expense");

    const { error: deleteSplitsError } = await supabase
      .from("expense_splits")
      .delete()
      .eq("expense_id", savedExpenseId);

    assertNoError(deleteSplitsError, "Could not replace expense splits");

    const { error: deleteItemsError } = await supabase
      .from("expense_items")
      .delete()
      .eq("expense_id", savedExpenseId);

    assertNoError(deleteItemsError, "Could not replace expense items");
  } else {
    const { data: insertedExpense, error: insertExpenseError } = await supabase
      .from("expenses")
      .insert({
        group_id: groupId,
        description: payload.description,
        expense_date: payload.date,
        paid_by: payload.paidBy,
        currency_code: payload.currencyCode,
        total_cents: totalCents,
        notes,
        split_mode: payload.mode,
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id")
      .single();

    assertNoError(insertExpenseError, "Could not create expense");

    if (!insertedExpense?.id) {
      throw new Error("Could not create expense.");
    }

    savedExpenseId = insertedExpense.id as string;
  }

  if (!savedExpenseId) {
    throw new Error("Expense could not be saved.");
  }

  const itemIdsByIndex: string[] = [];

  if (payload.mode === "itemized") {
    for (const item of payload.items) {
      const { data: insertedItem, error: insertItemError } = await supabase
        .from("expense_items")
        .insert({
          expense_id: savedExpenseId,
          name: item.name,
          amount_cents: item.amountCents,
        })
        .select("id")
        .single();

      assertNoError(insertItemError, "Could not create expense item");
      if (!insertedItem?.id) {
        throw new Error("Could not create expense item.");
      }

      itemIdsByIndex.push(insertedItem.id as string);
    }
  }

  const splitRows = computed.splitRows.map((row) => ({
    expense_id: savedExpenseId,
    participant_id: row.memberId,
    amount_cents: row.amountCents,
    item_id:
      typeof row.itemIndex === "number" && payload.mode === "itemized"
        ? (itemIdsByIndex[row.itemIndex] ?? null)
        : null,
  }));

  const { error: splitsInsertError } = await supabase.from("expense_splits").insert(splitRows);

  assertNoError(splitsInsertError, "Could not save expense splits");

  revalidatePath(`/g/${groupId}`);
  revalidatePath(`/g/${groupId}/expense/new`);
  redirect(`/g/${groupId}`);
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const rawGroupId = formData.get("groupId");
  const rawExpenseId = formData.get("expenseId");

  const groupId = typeof rawGroupId === "string" ? rawGroupId : "";
  const expenseId = typeof rawExpenseId === "string" ? rawExpenseId : "";

  if (!groupId || !expenseId) {
    throw new Error("Missing group ID or expense ID.");
  }

  const { error } = await supabase.from("expenses").delete().eq("id", expenseId).eq("group_id", groupId);

  assertNoError(error, "Could not delete expense");

  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}`);
}

export async function createPaymentAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const supabase = await createSupabaseServerClient();

  const groupId = typeof formData.get("groupId") === "string" ? (formData.get("groupId") as string) : "";
  const fromMemberId =
    typeof formData.get("fromMemberId") === "string" ? (formData.get("fromMemberId") as string) : "";
  const toMemberId =
    typeof formData.get("toMemberId") === "string" ? (formData.get("toMemberId") as string) : "";
  const amount = typeof formData.get("amount") === "string" ? (formData.get("amount") as string) : "";
  const paymentDate =
    typeof formData.get("paymentDate") === "string" ? (formData.get("paymentDate") as string) : "";
  const note = typeof formData.get("note") === "string" ? (formData.get("note") as string) : "";

  const parsed = paymentSchema.safeParse({
    groupId,
    fromMemberId,
    toMemberId,
    amountCents: parseAmountToCents(amount),
    paymentDate,
    note: note || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid payment.");
  }

  const { members } = await getGroupAndMembers(parsed.data.groupId);
  const memberSet = new Set(members.map((member) => member.userId));

  if (!memberSet.has(parsed.data.fromMemberId) || !memberSet.has(parsed.data.toMemberId)) {
    throw new Error("Payment members must belong to the group.");
  }

  const { error } = await supabase.from("payments").insert({
    group_id: parsed.data.groupId,
    from_member_id: parsed.data.fromMemberId,
    to_member_id: parsed.data.toMemberId,
    amount_cents: parsed.data.amountCents,
    payment_date: parsed.data.paymentDate,
    note: parsed.data.note || null,
    created_by: user.id,
  });

  assertNoError(error, "Could not record payment");

  revalidatePath(`/g/${parsed.data.groupId}`);
  redirect(`/g/${parsed.data.groupId}`);
}
