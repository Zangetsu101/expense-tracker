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
    if (specifier === 'react-native') return { url: 'controls-mock:native', shortCircuit: true };
    if (specifier === '@/theme') return { url: new URL('src/theme.ts', root).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'controls-mock:native') return { format: 'module', shortCircuit: true, source: "export const Pressable='Pressable',Text='Text',TextInput='TextInput',View='View',ActivityIndicator='ActivityIndicator';" };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { FormButton, FormInput, JoinedChoice } = await import('./form-controls.tsx');
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style;

test('shared form control behavior and accessibility', async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  const render = async element => { await act(async () => { if (renderer) renderer.update(element); else renderer = create(element); }); };
  t.after(async () => { await act(async () => renderer?.unmount()); hooks.deregister(); if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  await t.test('buttons expose busy/disabled and variant styles with pressed feedback', async () => {
    let calls = 0;
    await render(React.createElement(FormButton, { label: 'Save', onPress: () => calls++, style: { flex: 1 } }));
    let button = renderer.root.findByType('Pressable');
    button.props.onPress();
    assert.equal(calls, 1);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.equal(button.props.accessibilityLabel, 'Save');
    const normal = flatten(button.props.style({ pressed: false }));
    assert.equal(normal.backgroundColor, '#8be0be');
    assert.equal(normal.flex, 1);
    assert.ok(flatten(button.props.style({ pressed: true })).opacity < normal.opacity);
    for (const variant of ['secondary', 'danger']) {
      await render(React.createElement(FormButton, { label: 'Action', variant, disabled: true, onPress() {} }));
      button = renderer.root.findByType('Pressable');
      assert.equal(button.props.disabled, true);
      assert.equal(button.props.accessibilityState.disabled, true);
      assert.equal(flatten(button.props.style({ pressed: false })).backgroundColor, 'transparent');
      assert.equal(renderer.root.findByType('Text').props.style.color, variant === 'danger' ? '#f4c998' : '#f1f5f4');
    }
    await render(React.createElement(FormButton, { label: 'Save', loading: true, accessibilityLabel: 'Save category', onPress() {} }));
    button = renderer.root.findByType('Pressable');
    assert.deepEqual(button.props.accessibilityState, { disabled: true, busy: true });
    assert.equal(button.props.accessibilityLabel, 'Save category');
    assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 1);
  });
  await t.test('ordinary input forwards editing callbacks and native field props', async () => {
    let changed;
    await render(React.createElement(FormInput, { value: 'draft', onChangeText: value => changed = value, editable: false, keyboardType: 'decimal-pad', multiline: true, accessibilityLabel: 'Note', style: { minHeight: 100 } }));
    const input = renderer.root.findByType('TextInput');
    input.props.onChangeText('new');
    assert.equal(changed, 'new');
    assert.equal(input.props.editable, false);
    assert.equal(input.props.keyboardType, 'decimal-pad');
    assert.equal(input.props.multiline, true);
    assert.equal(flatten(input.props.style).fontSize, 16);
    assert.equal(flatten(input.props.style).minHeight, 100);
  });
  await t.test('joined choices expose selected state and forward values, then disable all choices', async () => {
    let changed;
    const props = { value: 'EXPENSE', style: { flex: 2 }, options: [{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }], onChange: value => changed = value };
    await render(React.createElement(JoinedChoice, props));
    let choices = renderer.root.findAllByType('Pressable');
    assert.equal(renderer.root.findByType('View').props.accessibilityRole, 'radiogroup');
    assert.equal(flatten(renderer.root.findByType('View').props.style).flex, 2);
    assert.equal(choices[0].props.accessibilityState.checked, true);
    assert.equal(choices[1].props.accessibilityState.checked, false);
    assert.equal(choices[0].props.style({ pressed: false }).backgroundColor, '#8be0be');
    assert.equal(choices[1].props.style({ pressed: false }).backgroundColor, '#1d2a34');
    choices[1].props.onPress();
    assert.equal(changed, 'INCOME');
    await render(React.createElement(JoinedChoice, { ...props, value: 'INCOME', disabled: true }));
    choices = renderer.root.findAllByType('Pressable');
    assert.ok(choices.every(choice => choice.props.disabled && choice.props.accessibilityState.disabled));
    assert.equal(choices[1].props.accessibilityState.checked, true);
  });
});
