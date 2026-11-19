import type { CategoryType } from './categories';

const suggestions: Record<CategoryType, Record<string, readonly string[]>> = {
  EXPENSE: {
    accommodation: ['🏨', '🛏️'],
    'balance adjustment': ['⚖️', '🧮'],
    'banking & payment fees': ['🏦', '💳'],
    'delivery & moving': ['🚚', '📦'],
    'eating out & drinks': ['🍽️', '🍔', '☕'],
    'education & learning': ['🎓', '📚'],
    'education & learning / books': ['📚', '📖'],
    'education & learning / courses': ['📝', '🎓'],
    entertainment: ['🎭', '🎬', '🎮'],
    'gifts & support': ['🎁', '🤝'],
    'gifts & support / charity': ['🤲', '❤️'],
    'gifts & support / family support': ['👪', '🤝'],
    'gifts & support / gifts given': ['🎁', '🎀'],
    health: ['🩺', '❤️‍🩹'],
    'health / fitness & sports': ['🏋️', '⚽', '🏃'],
    'health / medical care': ['🏥', '🩺'],
    'health / medicine': ['💊', '🧴'],
    home: ['🏠', '🏡'],
    'home / furnishings & equipment': ['🛋️', '🪑'],
    'home / groceries': ['🛒', '🥦', '🍎'],
    'home / home services': ['🛠️', '🏡'],
    'home / home services / housekeeping': ['🧹', '🧽'],
    'home / home services / laundry': ['🧺', '👕'],
    'home / household supplies': ['🧽', '🧴', '🧻'],
    'home / rent': ['🔑', '🏠'],
    'home / utilities': ['🔌', '💡'],
    'home / utilities / electricity': ['💡', '⚡'],
    'home / utilities / gas': ['🔥', '♨️'],
    'home / utilities / internet': ['🌐', '📶'],
    'home / utilities / phone': ['📱', '☎️'],
    'household spending': ['🧺', '🏠'],
    'household spending / supplementary card': ['💳', '👪'],
    'household spending / unitemized card spending': ['💳', '🧾'],
    investment: ['📈', '🌱'],
    'legal services': ['⚖️', '📜'],
    loan: ['🤝', '💸'],
    miscellaneous: ['📦', '🗂️'],
    'personal care': ['🪞', '🧴'],
    'personal care / salon': ['💇', '✂️', '💈'],
    qurbani: ['🐄'],
    repayment: ['↩️', '💸'],
    shopping: ['🛍️', '🛒'],
    'shopping / clothing & accessories': ['👕', '👗', '👜'],
    'shopping / electronics': ['💻', '🎧'],
    stationery: ['✏️', '🖊️', '📓'],
    subscriptions: ['🔁', '🗓️'],
    'subscriptions / entertainment': ['📺', '🎬', '🎵'],
    'subscriptions / software & services': ['💻', '⚙️'],
    taxes: ['🧾', '🏛️'],
    transport: ['🚘', '🚦'],
    'transport / air travel': ['✈️', '🧳'],
    'transport / public transport': ['🚌', '🚆', '🚇'],
    'transport / taxi/rideshare': ['🚕', '🚖'],
    'transport / vehicle costs': ['🚗', '🛞'],
    'transport / vehicle costs / fuel': ['⛽', '🛢️'],
    'transport / vehicle costs / parking': ['🅿️', '🚗'],
    'transport / vehicle costs / repairs & maintenance': ['🔧', '🛠️'],
    'transport / vehicle costs / tolls': ['🛣️', '🚧'],
    travel: ['🧳', '🗺️'],
    withdrawal: ['🏧', '💵'],
  },
  INCOME: {
    award: ['🏆', '🥇'],
    'balance adjustment': ['⚖️', '🧮'],
    cashback: ['🪙', '💳'],
    debt: ['🧾', '🤝'],
    'debt collection': ['💰', '↩️'],
    deposit: ['➕', '💵'],
    'gifts received': ['🎁', '🎉'],
    'incoming transfer': ['📥', '🔄'],
    interest: ['📊', '💰'],
    miscellaneous: ['📥', '🗂️'],
    refunds: ['↩️', '💵'],
    reimbursements: ['🤝', '💸'],
    salary: ['💼', '💵'],
    selling: ['🏷️', '🤝'],
  },
};

const expenseAliases: Record<string, string> = {
  grocery: 'home / groceries',
  groceries: 'home / groceries',
  supermarket: 'home / groceries',
  flights: 'transport / air travel',
  books: 'education & learning / books',
  bookshop: 'education & learning / books',
  barber: 'personal care / salon',
  salon: 'personal care / salon',
};

function uniqueLeafPaths(paths: Record<string, readonly string[]>): Map<string, string | null> {
  const leaves = new Map<string, string | null>();
  for (const path of Object.keys(paths)) {
    const leaf = path.split(' / ').at(-1)!;
    leaves.set(leaf, leaves.has(leaf) ? null : path);
  }
  return leaves;
}

const leafPaths = {
  EXPENSE: uniqueLeafPaths(suggestions.EXPENSE),
  INCOME: uniqueLeafPaths(suggestions.INCOME),
};

export function normalizeCategoryEmojiPath(path: string): string {
  return path.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function suggestCategoryEmoji(
  type: CategoryType,
  path: string,
  name: string,
): readonly string[] {
  const names = suggestions[type];
  const fullPath = normalizeCategoryEmojiPath(path);
  const leaf = normalizeCategoryEmojiPath(name);
  const alias =
    type === 'EXPENSE' && Object.hasOwn(expenseAliases, leaf) ? expenseAliases[leaf] : undefined;
  if (Object.hasOwn(names, fullPath)) return names[fullPath];
  const fallback = alias ?? leafPaths[type].get(leaf);
  return fallback ? names[fallback] : [];
}
