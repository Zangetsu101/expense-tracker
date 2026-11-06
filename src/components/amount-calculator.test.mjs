import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (
      ['react-native', 'react-native-reanimated', 'expo-haptics', 'expo-symbols'].includes(
        specifier,
      )
    )
      return { url: `calculator-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/'))
      return { url: new URL(`src/${specifier.slice(2)}.ts`, root).href, shortCircuit: true };
    return next(
      specifier,
      context.parentURL?.startsWith('calculator-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    const mocks = {
      'calculator-mock:react-native': "export const Pressable='Pressable',Text='Text',View='View';",
      'calculator-mock:expo-symbols': "export const SymbolView='SymbolView';",
      'calculator-mock:react-native-reanimated': `import { useRef } from 'react';
        export default { View: 'AnimatedView' };
        export const Easing = { out: x => x, cubic: x => x }, ReduceMotion = { System: 'system' };
        export const useSharedValue = value => useRef({ value }).current;
        export const useAnimatedStyle = fn => fn();
        export const withTiming = value => value;`,
      'calculator-mock:expo-haptics': `export const AndroidHaptics = { Keyboard_Tap: 'keyboard' }, ImpactFeedbackStyle = { Light: 'light' };
        export const performAndroidHapticsAsync = () => Promise.reject(new Error('Unavailable'));
        export const impactAsync = () => Promise.reject(new Error('Unavailable'));`,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: mocks[url] };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return next(url, context);
  },
});
const { AmountCalculator } = await import('./amount-calculator.tsx');

test('keypad remains usable without haptics and hides closed controls', async (t) => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousOS = process.env.EXPO_OS;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  let value = '12';
  let done = 0;
  const render = async (open) =>
    act(async () => {
      const element = React.createElement(AmountCalculator, {
        value,
        open,
        bottomInset: 24,
        onChange: (next) => {
          value = next;
        },
        onDone: () => done++,
      });
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  t.after(async () => {
    await act(async () => renderer?.unmount());
    hooks.deregister();
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    if (previousOS === undefined) delete process.env.EXPO_OS;
    else process.env.EXPO_OS = previousOS;
  });
  const key = (label) =>
    renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === label);
  for (const os of ['android', 'ios']) {
    process.env.EXPO_OS = os;
    await render(true);
    await act(async () => {
      key('3').props.onPressIn();
      key('3').props.onPress();
    });
    assert.equal(value, os === 'android' ? '123' : '1233');
  }
  await render(true);
  await act(async () => key('Done').props.onPress());
  assert.equal(done, 1);
  await act(async () => key('Hide amount keypad').props.onPress());
  assert.equal(done, 2);
  await render(false);
  const panel = renderer.root.findByType('AnimatedView');
  assert.equal(panel.props.pointerEvents, 'none');
  assert.equal(panel.props.accessibilityElementsHidden, true);
  assert.equal(panel.props.importantForAccessibility, 'no-hide-descendants');
  await render(true);
  assert.equal(renderer.root.findByType('AnimatedView').props.accessibilityElementsHidden, false);
});
