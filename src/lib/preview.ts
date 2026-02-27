import type { SplitMode } from "@/lib/splits";

export interface PreviewMember {
  userId: string;
  displayName: string;
}

export interface PreviewExpenseItem {
  id: string;
  name: string;
  amountCents: number;
}

export interface PreviewExpenseSplit {
  participantId: string;
  amountCents: number;
  itemId: string | null;
}

export interface PreviewExpense {
  id: string;
  description: string;
  expenseDate: string;
  paidBy: string;
  currencyCode: string;
  totalCents: number;
  notes: string | null;
  splitMode: SplitMode;
  items: PreviewExpenseItem[];
  splits: PreviewExpenseSplit[];
  createdAt: string;
}

export interface PreviewPayment {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  paymentDate: string;
  note: string | null;
  createdAt: string;
}

export interface PreviewGroup {
  id: string;
  name: string;
  currencyCode: string;
  members: PreviewMember[];
  expenses: PreviewExpense[];
  payments: PreviewPayment[];
}

export const PREVIEW_STORAGE_KEY = "billssplit_lite_preview_v2";

const DEFAULT_PREVIEW_GROUP: PreviewGroup = {
  id: "local-main-group",
  name: "My Group",
  currencyCode: "USD",
  members: [],
  expenses: [],
  payments: [],
};

export function getDefaultPreviewGroup(): PreviewGroup {
  return JSON.parse(JSON.stringify(DEFAULT_PREVIEW_GROUP)) as PreviewGroup;
}
