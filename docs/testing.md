# How to write tests

## Choose and run a suite

Write UI tests with Jest and React Native Testing Library (RNTL). Place each
`.test.tsx` file beside the component or feature it exercises, outside Expo
Router's route directory. For Node tests, use `.node.test.ts` and run
`pnpm test:node`. Node strips TypeScript syntax at runtime. The migrated Node
suites have legacy fixtures and stay outside the app's typecheck for now.

Run a focused UI suite with `pnpm test:ui --runTestsByPath <path>`, or a Node
suite with `node --test <path>`. Run `pnpm typecheck` separately because Jest
transpiles TypeScript. Run `pnpm check` before finishing.

## Behavior and isolation

Render real React Native controls, list rows, and application children. Assert
visible results, accessibility states, and public callbacks so tests survive
changes to component structure and styling.

Keep fixtures typed and scenarios independent. For controlled props, use a small
stateful parent to exercise callbacks and the resulting UI together. Keep setup
explicit. Extract shared render helpers when repeated provider setup justifies one.

For a pending read or write, use a promise the test can resolve or reject.
While it is pending, assert what the user can see and which controls they can
use. Settle the promise inside `act`, then assert the resulting UI.

When a saved choice should survive leaving a screen, unmount and reopen it
with the same query client and check the choice. To test persistence across
app launches, use a fresh client and read from the backing store.

## Queries and interactions

- Prefer `screen.getByRole` with an accessible name. Use `getByLabelText` for inputs.
  Distinguish similar controls with specific names or scoped queries.
- Use `queryBy*` for absence and `findBy*` for asynchronously appearing results.
- Create a fresh `userEvent.setup()` instance per interactive test and await its
  interactions.
- With RNTL 14, also await `render`, `rerender`, and `unmount`. These helpers handle
  `act` and automatic cleanup. Use explicit `act` for external callbacks or
  controlled promise resolutions that update rendered state.

## Console output

A passing run prints no React errors. [`src/test/setup.ts`](../src/test/setup.ts) does
not log an error that an error boundary catches. Assert the error fallback on
the screen. Do not replace `console.error` in a test, because that also hides
`act` warnings. When a test leaves a read pending, clear the query client inside
`act` in the teardown.

## Native interactions

Keep platform mocks local until multiple tests need them. Preserve rendered
children and public callback contracts. Exercise native dialog choices through the
buttons supplied to the native alert function.

Use device checks for native gestures, focus behavior, animation timing, and visual
layout.

## Examples

For search and controlled selection, see
[`screen.test.tsx`](../src/features/transaction-search/screen.test.tsx). For pending
operations and retry, see
[`settings-data-actions.test.tsx`](../src/components/settings-data-actions.test.tsx).
For native confirmation callbacks, see
[`backup-settings.test.tsx`](../src/components/backup-settings.test.tsx).
