# Testing

## Workflow

1. Read the test scripts in `package.json` and the runner configuration before
   choosing a suite. Migrate UI tests to colocated `.test.tsx` files outside Expo
   Router's route directory; retain the existing runner for unrelated tests.
2. Specify scenarios through public controls, visible outcomes, and callbacks.
   When replacing a test, account for each existing behavioral scenario.
3. Run the focused suite and TypeScript check during changes, then the repository
   check before completion. Jest transpiles TypeScript; typechecking is a separate
   check. Report failures and behavior that still needs device coverage.

## Behavior and isolation

Render real React Native controls, list rows, and application children. Assert
visible results, accessibility states, and public callbacks so tests survive
changes to component structure and styling.

Keep fixtures typed and scenarios independent. For controlled props, use a small
stateful parent to exercise callbacks and the resulting UI together. Keep setup
explicit; extract shared render helpers when repeated provider setup justifies one.

## Queries and interactions

- Prefer `screen.getByRole` with an accessible name; use `getByLabelText` for inputs.
  Distinguish similar controls with specific names or scoped queries.
- Use `queryBy*` for absence and `findBy*` for asynchronously appearing results.
- Create a fresh `userEvent.setup()` instance per interactive test and await its
  interactions.
- With RNTL 14, also await `render`, `rerender`, and `unmount`. These helpers handle
  `act` and automatic cleanup. Use explicit `act` for external callbacks or
  controlled promise resolutions that update rendered state.

## Native interactions

Keep platform mocks local until multiple tests need them. Preserve rendered
children and public callback contracts. Exercise native dialog choices through the
buttons supplied to the native alert function.

Use device checks for native gestures, focus behavior, animation timing, and visual
layout; presentation mocks establish only the JavaScript behavior around them.

## Examples and compatibility

For search and controlled selection, see
[`account-picker.test.tsx`](../src/features/home/account-picker.test.tsx). For pending
operations, retry, and native confirmation callbacks, see
[`settings-data-actions.test.tsx`](../src/components/settings-data-actions.test.tsx).

The `test-renderer` pin keeps its reconciler compatible with the app's React
version: renderer 1.2 supports React 19.2, while renderer 1.3.1 requires React 19.3.
Revisit the pin when upgrading React. Existing Node UI tests still use the separate
`react-test-renderer` package.
