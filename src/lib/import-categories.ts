// A planning step only: callers remove reconstructed Transfer rows before calling this.
// Mixed Categories remain untyped until the user confirms their classification.
export type ImportCategoryType = 'EXPENSE' | 'INCOME';

export interface CategorySignRow {
  category: string;
  amount: number;
}

export interface PlannedCategory {
  name: string;
  type: ImportCategoryType | null;
  needsConfirmation: boolean;
  expenseCount: number;
  incomeCount: number;
  parent: string | null;
}

const expenseGroups = {
  Transportation: ['Rickshaw', 'Bus', 'Taxi', 'Gulshan Chaka', 'Ride-sharing'],
  'Food & Beverage': ['Groceries', 'Snacks', 'Restaurants', 'Breakfast'],
  'Bills & Utilities': ['Phone Bill', 'Television Bill', 'Gas Bill', 'Internet'],
  'Gifts & Donations': ['Charity'],
} as const;

/** Names from the native recommended taxonomy; apply only when the observed sign agrees. */
function curatedParent(name: string, type: ImportCategoryType): string | null {
  if (type !== 'EXPENSE') return null;
  for (const [parent, children] of Object.entries(expenseGroups)) {
    if ((children as readonly string[]).includes(name)) return parent;
  }
  return null;
}

export function planImportCategories(rows: readonly CategorySignRow[]): {
  categories: PlannedCategory[];
} {
  const counts = new Map<string, { expense: number; income: number }>();
  for (const { category, amount } of rows) {
    const name = category.trim();
    if (!name || !Number.isFinite(amount) || amount === 0) continue;
    const count = counts.get(name) ?? { expense: 0, income: 0 };
    if (amount < 0) count.expense++;
    else count.income++;
    counts.set(name, count);
  }

  const categories: PlannedCategory[] = [];
  const parents = new Set<string>();
  for (const [name, { expense, income }] of counts) {
    const needsConfirmation = expense > 0 && income > 0;
    const type = needsConfirmation ? null : expense > 0 ? 'EXPENSE' : 'INCOME';
    const candidate = type ? curatedParent(name, type) : null;
    const parentCount = candidate ? counts.get(candidate) : undefined;
    const parent =
      parentCount && (parentCount.income > 0 || parentCount.expense === 0) ? null : candidate;
    if (parent && !parents.has(parent)) {
      const parentCount = counts.get(parent);
      if (!parentCount) {
        categories.push({
          name: parent,
          type: 'EXPENSE',
          needsConfirmation: false,
          expenseCount: 0,
          incomeCount: 0,
          parent: null,
        });
      }
      parents.add(parent);
    }
    categories.push({
      name,
      type,
      needsConfirmation,
      expenseCount: expense,
      incomeCount: income,
      parent,
    });
  }
  return { categories };
}
