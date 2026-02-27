import type { SplitMode } from "@/lib/splits";

export interface GroupMember {
  userId: string;
  displayName: string;
  joinedAt: string;
}

export interface ExpensePayloadBase {
  description: string;
  date: string;
  paidBy: string;
  currencyCode: string;
  notes?: string;
  mode: SplitMode;
}

export interface EqualPayload extends ExpensePayloadBase {
  mode: "equal";
  totalCents: number;
  participants: string[];
}

export interface ExactPayload extends ExpensePayloadBase {
  mode: "exact";
  totalCents: number;
  allocations: Array<{
    memberId: string;
    amountCents: number;
  }>;
}

export interface PercentPayload extends ExpensePayloadBase {
  mode: "percent";
  totalCents: number;
  allocations: Array<{
    memberId: string;
    percent: number;
  }>;
}

export interface SharesPayload extends ExpensePayloadBase {
  mode: "shares";
  totalCents: number;
  allocations: Array<{
    memberId: string;
    shares: number;
  }>;
}

export interface ItemizedPayload extends ExpensePayloadBase {
  mode: "itemized";
  items: Array<{
    name: string;
    amountCents: number;
    memberIds: string[];
  }>;
}

export type ExpensePayload =
  | EqualPayload
  | ExactPayload
  | PercentPayload
  | SharesPayload
  | ItemizedPayload;
