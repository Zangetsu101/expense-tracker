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
  'react-native': `export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable';`,
  '@/theme': `export const theme={colors:{selected:'selected'}};`,
  'react-native-reanimated': `const transition={duration(){return this},reduceMotion(value){return {duration:220,reduceMotion:value}}}; export const LinearTransition=transition,ReduceMotion={System:'system'}; export default {View:'AnimatedView'};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `chips:${specifier}`, shortCircuit: true };
    return next(specifier, context);
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
const chips = (renderer) => renderer.root.findAllByType('AnimatedView');
const labels = (renderer) =>
  chips(renderer).map((c) => c.findByType('Pressable').props.accessibilityLabel);

test('animation preserves both pre-existing two-row layouts and mounted chips across rows', async () => {
  const { renderer, props } = await mount();
  try {
    assert.deepEqual(labels(renderer), ['Food', 'Travel', 'Coffee', 'Shopping']);
    assert.deepEqual(
      chips(renderer).map((c) => c.props.style),
      [
        { position: 'absolute', start: 0, top: 0, width: 80, height: 60 },
        { position: 'absolute', start: 88, top: 0, width: 100, height: 60 },
        { position: 'absolute', start: 0, top: 68, width: 70, height: 40 },
        { position: 'absolute', start: 78, top: 68, width: 110, height: 40 },
      ],
    );
    const travel = chips(renderer)[1];
    await act(async () =>
      renderer.update(
        React.createElement(QuickSelectCategory, { ...props, orderedIds: [4, 3, 2, 1] }),
      ),
    );
    assert.deepEqual(labels(renderer), ['Shopping', 'Coffee', 'Travel', 'Food']);
    assert.equal(chips(renderer)[2], travel);
    assert.deepEqual(
      chips(renderer).map((c) => [c.props.style.start, c.props.style.top, c.props.style.height]),
      [
        [0, 0, 40],
        [118, 0, 40],
        [0, 48, 60],
        [108, 48, 60],
      ],
    );
    assert.equal(travel.findByType('Pressable').props.accessibilityState.selected, true);
    assert.equal(travel.props.layout.reduceMotion, 'system');
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
    await act(async () => chips(renderer)[0].findByType('Pressable').props.onPress());
    assert.equal(selected, 3);
    await act(async () => renderer.root.findByType('TextInput').props.onChangeText('absent'));
    assert.equal(chips(renderer).length, 0);
    assert.ok(
      renderer.root
        .findAllByType('Text')
        .some((t) => t.children.includes('No matching categories')),
    );
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('a tall offscreen Category cannot stretch visible measurement rows', async () => {
  const { renderer } = await mount();
  try {
    const hidden = renderer.root
      .findAllByType('View')
      .find((v) => v.props.importantForAccessibility === 'no-hide-descendants');
    assert.equal(hidden.props.style.alignItems, 'flex-start');
    const measures = hidden.findAllByType('View').filter((v) => v.props.onLayout);
    await act(async () => {
      renderer.root
        .findAllByType('View')
        .find((v) => v.props.onLayout)
        .props.onLayout({ nativeEvent: { layout: { width: 120 } } });
      measures[3].props.onLayout({ nativeEvent: { layout: { width: 110, height: 140 } } });
    });
    assert.deepEqual(labels(renderer), ['Food', 'Travel']);
    assert.deepEqual(
      chips(renderer).map((c) => [c.props.style.top, c.props.style.height]),
      [
        [0, 40],
        [48, 60],
      ],
    );
    assert.ok(
      renderer.root
        .findAllByType('Text')
        .some((t) => t.children.includes('Refine search to see more')),
    );
  } finally {
    await act(async () => renderer.unmount());
  }
});
