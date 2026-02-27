import { computeGroupBalances, type ExpenseBalanceRow, type PaymentBalanceRow } from "@/lib/balances";
import { suggestSettlements, type SuggestedSettlement } from "@/lib/settle";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function deriveDisplayName(email?: string | null): string {
  if (!email) {
    return "Member";
  }

  const head = email.split("@")[0]?.trim();
  return head && head.length > 0 ? head : "Member";
}

export interface ProfileView {
  id: string;
  displayName: string;
}

export interface GroupView {
  id: string;
  name: string;
  currencyCode: string;
  createdAt: string;
  createdBy: string;
}

export interface GroupMemberView {
  groupId: string;
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
  displayName: string;
}

export interface ExpenseItemView {
  id: string;
  expenseId: string;
  name: string;
  amountCents: number;
}

export interface ExpenseSplitView {
  id: string;
  expenseId: string;
  participantId: string;
  amountCents: number;
  itemId: string | null;
}

export interface ExpenseView {
  id: string;
  groupId: string;
  description: string;
  expenseDate: string;
  paidBy: string;
  currencyCode: string;
  totalCents: number;
  notes: string | null;
  splitMode: "equal" | "exact" | "percent" | "shares" | "itemized";
  createdAt: string;
  items: ExpenseItemView[];
  splits: ExpenseSplitView[];
}

export interface PaymentView {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  paymentDate: string;
  note: string | null;
  createdAt: string;
}

export interface GroupOverview {
  group: GroupView;
  members: GroupMemberView[];
  expenses: ExpenseView[];
  payments: PaymentView[];
  balances: Record<string, number>;
  suggestions: SuggestedSettlement[];
}

export interface InviteInfoView {
  groupId: string;
  groupName: string;
  currencyCode: string;
  expiresAt: string;
  isExpired: boolean;
  alreadyMember: boolean;
}

export async function ensureOwnProfile(userId: string, email?: string | null): Promise<ProfileView> {
  const supabase = await createSupabaseServerClient();

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();

  assertNoError(existingProfileError, "Could not read profile");

  if (existingProfile) {
    return {
      id: existingProfile.id as string,
      displayName: (existingProfile.display_name as string) || "Member",
    };
  }

  const displayName = deriveDisplayName(email);

  const { data: insertedProfile, error: insertedProfileError } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      display_name: displayName,
    })
    .select("id, display_name")
    .single();

  assertNoError(insertedProfileError, "Could not create profile");

  if (!insertedProfile?.id) {
    throw new Error("Could not create profile.");
  }

  return {
    id: insertedProfile.id as string,
    displayName: (insertedProfile.display_name as string) || "Member",
  };
}

export async function listGroupsForUser(userId: string): Promise<GroupView[]> {
  const supabase = await createSupabaseServerClient();

  const { data: membershipRows, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  assertNoError(membershipError, "Could not read group memberships");

  const groupIds = Array.from(new Set((membershipRows ?? []).map((row) => row.group_id as string)));

  if (groupIds.length === 0) {
    return [];
  }

  const { data: groupRows, error: groupsError } = await supabase
    .from("groups")
    .select("id, name, currency_code, created_at, created_by")
    .in("id", groupIds)
    .order("created_at", { ascending: false });

  assertNoError(groupsError, "Could not read groups");

  return (groupRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    currencyCode: row.currency_code as string,
    createdAt: row.created_at as string,
    createdBy: row.created_by as string,
  }));
}

export async function getGroupAndMembers(groupId: string): Promise<{
  group: GroupView;
  members: GroupMemberView[];
}> {
  const supabase = await createSupabaseServerClient();

  const { data: groupRow, error: groupError } = await supabase
    .from("groups")
    .select("id, name, currency_code, created_at, created_by")
    .eq("id", groupId)
    .maybeSingle();

  assertNoError(groupError, "Could not read group");

  if (!groupRow) {
    throw new Error("Group not found or access denied.");
  }

  const { data: memberRows, error: membersError } = await supabase
    .from("group_members")
    .select("group_id, user_id, role, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  assertNoError(membersError, "Could not read group members");

  const memberUserIds = (memberRows ?? []).map((row) => row.user_id as string);

  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", memberUserIds.length ? memberUserIds : ["00000000-0000-0000-0000-000000000000"]);

  assertNoError(profilesError, "Could not read profiles");

  const profileMap = new Map<string, string>(
    (profileRows ?? []).map((row) => [row.id as string, ((row.display_name as string) || "Member").trim()]),
  );

  return {
    group: {
      id: groupRow.id as string,
      name: groupRow.name as string,
      currencyCode: groupRow.currency_code as string,
      createdAt: groupRow.created_at as string,
      createdBy: groupRow.created_by as string,
    },
    members: (memberRows ?? []).map((row) => ({
      groupId: row.group_id as string,
      userId: row.user_id as string,
      role: (row.role as "owner" | "member") ?? "member",
      joinedAt: row.joined_at as string,
      displayName: profileMap.get(row.user_id as string) ?? "Member",
    })),
  };
}

export async function getExpenseById(expenseId: string): Promise<ExpenseView | null> {
  const supabase = await createSupabaseServerClient();

  const { data: expenseRow, error: expenseError } = await supabase
    .from("expenses")
    .select(
      "id, group_id, description, expense_date, paid_by, currency_code, total_cents, notes, split_mode, created_at",
    )
    .eq("id", expenseId)
    .maybeSingle();

  assertNoError(expenseError, "Could not read expense");

  if (!expenseRow) {
    return null;
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from("expense_items")
    .select("id, expense_id, name, amount_cents")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });

  assertNoError(itemsError, "Could not read expense items");

  const { data: splitRows, error: splitsError } = await supabase
    .from("expense_splits")
    .select("id, expense_id, participant_id, amount_cents, item_id")
    .eq("expense_id", expenseId);

  assertNoError(splitsError, "Could not read expense splits");

  return {
    id: expenseRow.id as string,
    groupId: expenseRow.group_id as string,
    description: expenseRow.description as string,
    expenseDate: expenseRow.expense_date as string,
    paidBy: expenseRow.paid_by as string,
    currencyCode: expenseRow.currency_code as string,
    totalCents: expenseRow.total_cents as number,
    notes: (expenseRow.notes as string | null) ?? null,
    splitMode: expenseRow.split_mode as ExpenseView["splitMode"],
    createdAt: expenseRow.created_at as string,
    items: (itemRows ?? []).map((row) => ({
      id: row.id as string,
      expenseId: row.expense_id as string,
      name: row.name as string,
      amountCents: row.amount_cents as number,
    })),
    splits: (splitRows ?? []).map((row) => ({
      id: row.id as string,
      expenseId: row.expense_id as string,
      participantId: row.participant_id as string,
      amountCents: row.amount_cents as number,
      itemId: (row.item_id as string | null) ?? null,
    })),
  };
}

export async function getGroupOverview(groupId: string): Promise<GroupOverview> {
  const { group, members } = await getGroupAndMembers(groupId);
  const supabase = await createSupabaseServerClient();

  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select(
      "id, group_id, description, expense_date, paid_by, currency_code, total_cents, notes, split_mode, created_at",
    )
    .eq("group_id", groupId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  assertNoError(expensesError, "Could not read expenses");

  const expenseIds = (expenseRows ?? []).map((row) => row.id as string);

  const [itemsResult, splitsResult] = await Promise.all([
    expenseIds.length
      ? supabase
          .from("expense_items")
          .select("id, expense_id, name, amount_cents")
          .in("expense_id", expenseIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    expenseIds.length
      ? supabase
          .from("expense_splits")
          .select("id, expense_id, participant_id, amount_cents, item_id")
          .in("expense_id", expenseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  assertNoError(itemsResult.error, "Could not read expense items");
  assertNoError(splitsResult.error, "Could not read expense splits");

  const { data: paymentRows, error: paymentsError } = await supabase
    .from("payments")
    .select("id, group_id, from_member_id, to_member_id, amount_cents, payment_date, note, created_at")
    .eq("group_id", groupId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  assertNoError(paymentsError, "Could not read payments");

  const itemsByExpense = new Map<string, ExpenseItemView[]>();
  for (const row of itemsResult.data ?? []) {
    const expenseId = row.expense_id as string;
    const list = itemsByExpense.get(expenseId) ?? [];
    list.push({
      id: row.id as string,
      expenseId,
      name: row.name as string,
      amountCents: row.amount_cents as number,
    });
    itemsByExpense.set(expenseId, list);
  }

  const splitsByExpense = new Map<string, ExpenseSplitView[]>();
  for (const row of splitsResult.data ?? []) {
    const expenseId = row.expense_id as string;
    const list = splitsByExpense.get(expenseId) ?? [];
    list.push({
      id: row.id as string,
      expenseId,
      participantId: row.participant_id as string,
      amountCents: row.amount_cents as number,
      itemId: (row.item_id as string | null) ?? null,
    });
    splitsByExpense.set(expenseId, list);
  }

  const expenses: ExpenseView[] = (expenseRows ?? []).map((row) => {
    const expenseId = row.id as string;
    return {
      id: expenseId,
      groupId: row.group_id as string,
      description: row.description as string,
      expenseDate: row.expense_date as string,
      paidBy: row.paid_by as string,
      currencyCode: row.currency_code as string,
      totalCents: row.total_cents as number,
      notes: (row.notes as string | null) ?? null,
      splitMode: row.split_mode as ExpenseView["splitMode"],
      createdAt: row.created_at as string,
      items: itemsByExpense.get(expenseId) ?? [],
      splits: splitsByExpense.get(expenseId) ?? [],
    };
  });

  const payments: PaymentView[] = (paymentRows ?? []).map((row) => ({
    id: row.id as string,
    groupId: row.group_id as string,
    fromMemberId: row.from_member_id as string,
    toMemberId: row.to_member_id as string,
    amountCents: row.amount_cents as number,
    paymentDate: row.payment_date as string,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
  }));

  const expenseBalanceRows: ExpenseBalanceRow[] = expenses.map((expense) => ({
    paidBy: expense.paidBy,
    totalCents: expense.totalCents,
    splits: expense.splits.map((split) => ({
      participantId: split.participantId,
      amountCents: split.amountCents,
    })),
  }));

  const paymentBalanceRows: PaymentBalanceRow[] = payments.map((payment) => ({
    fromMemberId: payment.fromMemberId,
    toMemberId: payment.toMemberId,
    amountCents: payment.amountCents,
  }));

  const balances = computeGroupBalances(
    members.map((member) => member.userId),
    expenseBalanceRows,
    paymentBalanceRows,
  );

  return {
    group,
    members,
    expenses,
    payments,
    balances,
    suggestions: suggestSettlements(balances),
  };
}

export async function getInviteInfoByToken(token: string): Promise<InviteInfoView | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_invite_info", {
    invite_token: token,
  });

  assertNoError(error, "Could not read invite");

  const rows = (data ?? []) as Array<{
    group_id: string;
    group_name: string;
    currency_code: string;
    expires_at: string;
    is_expired: boolean;
    already_member: boolean;
  }>;

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    groupId: row.group_id,
    groupName: row.group_name,
    currencyCode: row.currency_code,
    expiresAt: row.expires_at,
    isExpired: row.is_expired,
    alreadyMember: row.already_member,
  };
}
