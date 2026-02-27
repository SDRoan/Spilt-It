export type SplitMode = "equal" | "exact" | "percent" | "shares" | "itemized";

export interface WeightedAllocation {
  memberId: string;
  weight: number;
}

export interface ExplicitAllocation {
  memberId: string;
  amountCents: number;
}

export interface PercentAllocation {
  memberId: string;
  percent: number;
}

export interface ShareAllocation {
  memberId: string;
  shares: number;
}

export interface ItemizedInput {
  name: string;
  amountCents: number;
  memberIds: string[];
}

export interface ExpenseSplitInput {
  mode: SplitMode;
  totalCents?: number;
  participants?: string[];
  exactAllocations?: ExplicitAllocation[];
  percentAllocations?: PercentAllocation[];
  shareAllocations?: ShareAllocation[];
  itemizedItems?: ItemizedInput[];
}

export interface ComputedSplitRow {
  memberId: string;
  amountCents: number;
  itemIndex?: number;
}

export interface ComputedExpenseSplit {
  totalCents: number;
  participantTotals: Record<string, number>;
  splitRows: ComputedSplitRow[];
}

interface FractionBucket {
  memberId: string;
  base: number;
  fractional: number;
}

function ensurePositiveAmount(totalCents: number): void {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("Expense total must be greater than 0 cents.");
  }
}

function uniqueMembers(memberIds: string[]): string[] {
  const unique = Array.from(new Set(memberIds.filter(Boolean)));

  if (unique.length === 0) {
    throw new Error("At least one participant is required.");
  }

  return unique;
}

function buildParticipantTotals(rows: ComputedSplitRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.memberId] = (acc[row.memberId] ?? 0) + row.amountCents;
    return acc;
  }, {});
}

export function allocateByWeights(
  totalCents: number,
  weightedAllocations: WeightedAllocation[],
): ExplicitAllocation[] {
  ensurePositiveAmount(totalCents);

  const normalized = weightedAllocations.filter((entry) => entry.weight > 0);

  if (normalized.length === 0) {
    throw new Error("At least one positive weight is required.");
  }

  const totalWeight = normalized.reduce((sum, entry) => sum + entry.weight, 0);

  if (totalWeight <= 0) {
    throw new Error("Total weight must be greater than 0.");
  }

  const buckets: FractionBucket[] = normalized.map((entry) => {
    const raw = (totalCents * entry.weight) / totalWeight;
    const base = Math.floor(raw);

    return {
      memberId: entry.memberId,
      base,
      fractional: raw - base,
    };
  });

  const remainder = totalCents - buckets.reduce((sum, bucket) => sum + bucket.base, 0);

  buckets.sort((a, b) => {
    if (b.fractional !== a.fractional) {
      return b.fractional - a.fractional;
    }

    return a.memberId.localeCompare(b.memberId);
  });

  for (let i = 0; i < remainder; i += 1) {
    buckets[i % buckets.length].base += 1;
  }

  return buckets
    .sort((a, b) => a.memberId.localeCompare(b.memberId))
    .map((bucket) => ({ memberId: bucket.memberId, amountCents: bucket.base }));
}

function computeEqualSplit(totalCents: number, participants: string[]): ComputedExpenseSplit {
  const memberIds = uniqueMembers(participants);
  const allocations = allocateByWeights(
    totalCents,
    memberIds.map((memberId) => ({ memberId, weight: 1 })),
  );
  const rows = allocations.map((allocation) => ({
    memberId: allocation.memberId,
    amountCents: allocation.amountCents,
  }));

  return {
    totalCents,
    participantTotals: buildParticipantTotals(rows),
    splitRows: rows,
  };
}

function computeExactSplit(
  totalCents: number,
  exactAllocations: ExplicitAllocation[] | undefined,
): ComputedExpenseSplit {
  ensurePositiveAmount(totalCents);

  if (!exactAllocations || exactAllocations.length === 0) {
    throw new Error("Exact split requires per-member amounts.");
  }

  const rows = exactAllocations
    .filter((allocation) => allocation.amountCents > 0)
    .map((allocation) => {
      if (!Number.isInteger(allocation.amountCents) || allocation.amountCents < 0) {
        throw new Error("Exact split amounts must be non-negative integers.");
      }

      return {
        memberId: allocation.memberId,
        amountCents: allocation.amountCents,
      };
    });

  if (rows.length === 0) {
    throw new Error("Exact split needs at least one non-zero amount.");
  }

  const sum = rows.reduce((acc, row) => acc + row.amountCents, 0);

  if (sum !== totalCents) {
    throw new Error("Exact split amounts must add up to the expense total.");
  }

  return {
    totalCents,
    participantTotals: buildParticipantTotals(rows),
    splitRows: rows,
  };
}

function computePercentSplit(
  totalCents: number,
  percentAllocations: PercentAllocation[] | undefined,
): ComputedExpenseSplit {
  ensurePositiveAmount(totalCents);

  if (!percentAllocations || percentAllocations.length === 0) {
    throw new Error("Percent split requires per-member percentages.");
  }

  const activePercentages = percentAllocations.filter((allocation) => allocation.percent > 0);
  if (activePercentages.length === 0) {
    throw new Error("Percent split requires at least one positive percentage.");
  }

  const percentSum = activePercentages.reduce((sum, allocation) => sum + allocation.percent, 0);

  if (Math.abs(percentSum - 100) > 0.001) {
    throw new Error("Percent split must total 100%.");
  }

  const allocations = allocateByWeights(
    totalCents,
    activePercentages.map((allocation) => ({
      memberId: allocation.memberId,
      weight: allocation.percent,
    })),
  );

  const rows = allocations.map((allocation) => ({
    memberId: allocation.memberId,
    amountCents: allocation.amountCents,
  }));

  return {
    totalCents,
    participantTotals: buildParticipantTotals(rows),
    splitRows: rows,
  };
}

function computeShareSplit(
  totalCents: number,
  shareAllocations: ShareAllocation[] | undefined,
): ComputedExpenseSplit {
  ensurePositiveAmount(totalCents);

  if (!shareAllocations || shareAllocations.length === 0) {
    throw new Error("Shares split requires per-member share weights.");
  }

  const activeShares = shareAllocations.filter((allocation) => allocation.shares > 0);

  if (activeShares.length === 0) {
    throw new Error("Shares split requires at least one positive share value.");
  }

  const allocations = allocateByWeights(
    totalCents,
    activeShares.map((allocation) => ({
      memberId: allocation.memberId,
      weight: allocation.shares,
    })),
  );

  const rows = allocations.map((allocation) => ({
    memberId: allocation.memberId,
    amountCents: allocation.amountCents,
  }));

  return {
    totalCents,
    participantTotals: buildParticipantTotals(rows),
    splitRows: rows,
  };
}

function computeItemizedSplit(items: ItemizedInput[] | undefined): ComputedExpenseSplit {
  if (!items || items.length === 0) {
    throw new Error("Itemized split requires at least one item.");
  }

  const normalized = items.map((item, index) => {
    if (!Number.isInteger(item.amountCents) || item.amountCents <= 0) {
      throw new Error(`Item #${index + 1} must have a positive integer amount.`);
    }

    const memberIds = uniqueMembers(item.memberIds);

    return {
      name: item.name,
      amountCents: item.amountCents,
      memberIds,
    };
  });

  const rows: ComputedSplitRow[] = [];

  normalized.forEach((item, itemIndex) => {
    const allocations = allocateByWeights(
      item.amountCents,
      item.memberIds.map((memberId) => ({ memberId, weight: 1 })),
    );

    allocations.forEach((allocation) => {
      rows.push({
        memberId: allocation.memberId,
        amountCents: allocation.amountCents,
        itemIndex,
      });
    });
  });

  const totalCents = normalized.reduce((sum, item) => sum + item.amountCents, 0);

  return {
    totalCents,
    participantTotals: buildParticipantTotals(rows),
    splitRows: rows,
  };
}

export function computeExpenseSplit(input: ExpenseSplitInput): ComputedExpenseSplit {
  switch (input.mode) {
    case "equal": {
      if (!input.totalCents) {
        throw new Error("Equal split requires total cents.");
      }
      return computeEqualSplit(input.totalCents, input.participants ?? []);
    }

    case "exact": {
      if (!input.totalCents) {
        throw new Error("Exact split requires total cents.");
      }
      return computeExactSplit(input.totalCents, input.exactAllocations);
    }

    case "percent": {
      if (!input.totalCents) {
        throw new Error("Percent split requires total cents.");
      }
      return computePercentSplit(input.totalCents, input.percentAllocations);
    }

    case "shares": {
      if (!input.totalCents) {
        throw new Error("Shares split requires total cents.");
      }
      return computeShareSplit(input.totalCents, input.shareAllocations);
    }

    case "itemized":
      return computeItemizedSplit(input.itemizedItems);

    default:
      throw new Error("Unsupported split mode.");
  }
}
