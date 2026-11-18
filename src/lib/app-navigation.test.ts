import { appTabs } from './app-navigation';

test('the four tabs have distinct icons on iOS and Android', () => {
  expect(appTabs.map((tab) => tab.label)).toEqual(['Home', 'Reports', 'Accounts', 'Categories']);
  for (const platform of ['sf', 'md'] as const)
    expect(new Set(appTabs.map((tab) => tab[platform])).size).toBe(4);
});
