# Testing

`pnpm test` runs both suites:

- `pnpm test:node`: existing `.test.mjs` tests using Node's test runner.
- `pnpm test:ui`: TypeScript UI tests using Jest, `jest-expo`, and React Native Testing Library (RNTL).

Run a focused UI test with `pnpm test:ui src/features/home/account-picker.test.tsx`.
`pnpm typecheck` checks TypeScript tests as well as application code. Jest transpiles
TypeScript but does not typecheck it. `pnpm check` includes both checks.

## UI tests

Test behavior through public props, accessible controls, visible results, and
callbacks. Render real React Native controls and list rows.

- Colocate `.test.tsx` with the rendered code, outside Expo Router's route directory.
- Use `screen.getByRole` with an accessible name for buttons, and `getByLabelText`
  for inputs. Use specific accessible names or scoped queries to distinguish
  controls with similar text.
- Create a fresh `userEvent.setup()` instance for each interactive test and await
  interactions.
- With RNTL 14, await `render`, `rerender`, and `unmount` too. Normal interactions
  do not need an explicit `act` wrapper. Cleanup happens automatically.
- Assert visible results, semantic accessibility states, and public callbacks.
  Avoid component counts, internal props, exact colors, and snapshots of whole trees.
- Use `queryBy*` for absence; use `findBy*` when results arrive asynchronously.
- Keep fixtures typed. For a controlled prop, a small stateful
  parent can exercise the callback and resulting UI together.
- Keep native presentation mocks local until multiple tests need the same mock.
  Preserve rendered children and public callbacks in mocks so the behavior under
  test stays real. Native presentation mocks do not establish gesture, focus, or
  animation behavior.
- Keep each scenario independent. Prefer explicit test setup over a configurable
  render helper until repeated provider setup justifies one.

Animation timing, native gestures, and visual layout need device checks.

For a worked example, see `src/features/home/account-picker.test.tsx`.

## Package compatibility

`jest-expo` matches SDK 57. RNTL 14 uses `test-renderer`, separate from the old
`react-test-renderer` retained by the Node UI tests. `test-renderer` is pinned to
1.2.0: its React reconciler supports this app's React 19.2; the 1.3.1 renderer
requires React 19.3. Revisit that pin when React is upgraded.

The pilot deliberately keeps Node's runner for existing logic and script tests.
Moving those to TypeScript is separate from adopting RNTL for UI behavior.
