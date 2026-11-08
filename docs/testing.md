# Testing

`pnpm test` runs both suites:

- `pnpm test:node`: existing `.test.mjs` tests using Node's test runner.
- `pnpm test:ui`: TypeScript UI tests using Jest, `jest-expo`, and React Native Testing Library (RNTL).

Run a focused UI test with `pnpm test:ui src/features/home/account-picker.test.tsx`.
`pnpm typecheck` checks TypeScript tests as well as application code. Jest transpiles
TypeScript but does not typecheck it. `pnpm check` includes both checks.

## UI pilot: Home Account picker

The pilot is `src/features/home/account-picker.test.tsx`. It exercises the public
props, accessible controls, visible results, and selection callbacks. Search and
selection run through real React Native controls and `FlatList` rows.

Use these patterns when reviewing the pilot or migrating another UI test:

- Colocate `.test.tsx` with the rendered code, outside Expo Router's route directory.
- Use `screen.getByRole` with an accessible name for buttons, and `getByLabelText`
  for inputs. Distinguish the selected Account's chooser from its result row.
- Use `userEvent.setup()` in each interactive test and await interactions.
- With RNTL 14, await `render`, `rerender`, and `unmount` too. Normal interactions
  do not need an explicit `act` wrapper. Cleanup happens automatically.
- Assert visible results, semantic accessibility states, and public callbacks.
  Avoid component counts, internal props, exact colors, and snapshots of whole trees.
- Use `queryBy*` for absence; use `findBy*` when results arrive asynchronously.
- Keep fixtures typed (`Account[]` here). For a controlled prop, a small stateful
  parent can exercise the callback and resulting UI together.
- Keep native presentation mocks local until multiple tests need the same mock.
  The sheet mock renders its children and exposes dismissal through the existing
  `onDismiss` contract. It does not simulate native gestures, focus, or animation.
- Keep each scenario independent. Prefer explicit test setup over a configurable
  render helper until repeated provider setup justifies one.

The placeholder test checks that it exposes no actions. Animation timing, native
sheet gestures, and visual layout need device checks; this suite does not establish
those behaviors.

## Package compatibility

`jest-expo` matches SDK 57. RNTL 14 uses `test-renderer`, separate from the old
`react-test-renderer` retained by the Node UI tests. `test-renderer` is pinned to
1.2.0: its React reconciler supports this app's React 19.2; the 1.3.1 renderer
requires React 19.3. Revisit that pin when React is upgraded.

The pilot deliberately keeps Node's runner for existing logic and script tests.
Moving those to TypeScript is separate from adopting RNTL for UI behavior.
