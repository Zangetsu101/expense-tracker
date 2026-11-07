import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mocks = {
  'react-native': `export const I18nManager={isRTL:false}; export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable';`,
  '@/theme': `export const theme={colors:{selected:'selected'}};`,
  'react-native-reanimated': `import {useRef} from 'react'; export const ReduceMotion={System:'system'}; export const useSharedValue=value=>useRef({value,get(){return this.value},set(v){this.value=v}}).current; export const useAnimatedStyle=fn=>fn(); export const withTiming=value=>value; export default {createAnimatedComponent:()=> 'AnimatedPressable'};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `chips:${specifier}`, shortCircuit: true };
    return next(
      specifier,
      context.parentURL?.startsWith('chips:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('chips:'))
      return { format: 'module', source: mocks[url.slice(6)], shortCircuit: true };
    if (url.endsWith('.tsx'))
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
const { QuickSelectCategory } = await import('./quick-select-category.tsx');
after(() => {
  hooks.deregister();
  if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
});
const categories = ['Food', 'Travel', 'Coffee', 'Shopping'].map((name, i) => ({
  id: i + 1,
  name,
  type: 'EXPENSE',
  parentId: null,
  parentName: null,
  needsReview: 0,
}));

async function mount(extra = {}) {
  let renderer;
  const props = { categories, selectedId: 2, onSelect() {}, ...extra };
  await act(async () => {
    renderer = create(React.createElement(QuickSelectCategory, props));
  });
  await act(async () => {
    const views = renderer.root.findAllByType('View');
    views.find((v) => v.props.onLayout).props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    const measurements = views.filter((v) => v.props.onLayout).slice(1);
    [80, 100, 70, 110].forEach((width, i) =>
      measurements[i].props.onLayout({
        nativeEvent: { layout: { width, height: i === 1 ? 60 : 40 } },
      }),
    );
  });
  return { renderer, props };
}
const chips = (renderer) => renderer.root.findAllByType('AnimatedPressable');
const labels = (renderer) => chips(renderer).map((c) => c.props.accessibilityLabel);

test('native wrapping preserves visible order and mounted chips across row changes', async () => {
  const { renderer, props } = await mount();
  try {
    assert.deepEqual(labels(renderer), ['Food', 'Travel', 'Coffee', 'Shopping']);
    const travel = chips(renderer)[1];
    let parent = travel.parent;
    while (parent.type !== 'View') parent = parent.parent;
    assert.equal(parent.props.collapsable, false);
    assert.equal(parent.props.style.flexWrap, 'wrap');
    assert.equal(parent.props.style.gap, 8);
    assert.equal(parent.props.style.paddingBottom, 0);
    await act(async () => travel.props.onLayout({ nativeEvent: { layout: { x: 88, y: 0 } } }));
    await act(async () =>
      renderer.update(
        React.createElement(QuickSelectCategory, { ...props, orderedIds: [4, 3, 2, 1] }),
      ),
    );
    assert.deepEqual(labels(renderer), ['Shopping', 'Coffee', 'Travel', 'Food']);
    assert.equal(chips(renderer)[2], travel);
    await act(async () => travel.props.onLayout({ nativeEvent: { layout: { x: 0, y: 48 } } }));
    assert.equal(travel.props.accessibilityState.selected, true);
    assert.deepEqual(travel.props.style[1].transform, [{ translateX: 0 }, { translateY: 0 }]);
  } finally {
    await act(async () => renderer.unmount());
  }
});
test('search, overflow, parent paths and selection retain their meaning after reorder', async () => {
  let selected;
  const { renderer, props } = await mount({
    onSelect: (id) => {
      selected = id;
    },
    categories: categories.map((c) => (c.id === 3 ? { ...c, parentId: 1 } : c)),
  });
  try {
    await act(async () => renderer.root.findByType('TextInput').props.onChangeText('food'));
    assert.deepEqual(labels(renderer), ['Food', 'Food › Coffee']);
    await act(async () =>
      renderer.update(
        React.createElement(QuickSelectCategory, { ...props, orderedIds: [3, 4, 2, 1] }),
      ),
    );
    assert.deepEqual(labels(renderer), ['Food › Coffee', 'Food']);
    await act(async () => chips(renderer)[0].props.onPress());
    assert.equal(selected, 3);
    await act(async () => renderer.root.findByType('TextInput').props.onChangeText('absent'));
    assert.equal(chips(renderer).length, 0);
    assert.equal(
      renderer.root.findAllByType('View').find((v) => v.props.collapsable === false).props.style
        .paddingBottom,
      8,
    );
    assert.ok(
      renderer.root
        .findAllByType('Text')
        .some((t) => t.children.includes('No matching categories')),
    );
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('offscreen Categories do not affect visible row membership or selection', async () => {
  const { renderer } = await mount();
  try {
    await act(async () =>
      renderer.root
        .findAllByType('View')
        .find((v) => v.props.onLayout)
        .props.onLayout({ nativeEvent: { layout: { width: 120 } } }),
    );
    assert.deepEqual(labels(renderer), ['Food', 'Travel']);
    assert.equal(chips(renderer)[1].props.accessibilityState.selected, true);
    assert.ok(
      renderer.root
        .findAllByType('Text')
        .some((t) => t.children.includes('Refine search to see more')),
    );
  } finally {
    await act(async () => renderer.unmount());
  }
});
