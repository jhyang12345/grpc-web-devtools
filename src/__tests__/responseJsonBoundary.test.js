import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { buildResponseSource, NetworkDetails } from '../components/NetworkDetails';
import { limitPayload } from '../state/networkCache';

let fixtures;
let consoleError;

beforeEach(() => {
  fixtures = [];
  localStorage.clear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fixtures.forEach(({ container }) => {
    act(() => { ReactDOM.unmountComponentAtNode(container); });
    container.remove();
  });
  consoleError.mockRestore();
});

function renderResponse(source, collapsed = false) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const clearLogAndCache = jest.fn();
  const onToolbarAction = jest.fn();
  const component = new NetworkDetails({ locale: 'en', showToast: jest.fn() });
  component.state = { ...component.state, isRendering: true, responseCollapsed: collapsed };
  component._copyText = jest.fn();
  let currentSource = source;

  const render = (nextSource = currentSource) => {
    currentSource = nextSource;
    act(() => {
      ReactDOM.render(
        <ErrorBoundary clearLogAndCache={clearLogAndCache}>
          <button className="toolbar-sentinel" onClick={onToolbarAction}>Toolbar action</button>
          {component._renderResponsePane(
            currentSource,
            JSON.stringify(currentSource, null, 2),
            false,
            false,
            true
          )}
        </ErrorBoundary>,
        container
      );
    });
  };
  component.setState = (nextState, callback) => {
    const update = typeof nextState === 'function' ? nextState(component.state) : nextState;
    component.state = { ...component.state, ...update };
    render();
    if (callback) callback();
  };
  const fixture = { container, component, clearLogAndCache, onToolbarAction, render };
  fixtures.push(fixture);
  render();
  return fixture;
}

function click(element) {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function expectContainedFallback(fixture, source) {
  const { container, clearLogAndCache, onToolbarAction, component } = fixture;
  const fallback = container.querySelector('.response-json-fallback');
  expect(fallback).not.toBeNull();
  expect(fallback.textContent).toBe(JSON.stringify(source, null, 2));
  expect(JSON.parse(fallback.textContent)).toEqual(source);
  expect(container.querySelector('.error-boundary')).toBeNull();
  expect(clearLogAndCache).not.toHaveBeenCalled();

  click(container.querySelector('.toolbar-sentinel'));
  expect(onToolbarAction).toHaveBeenCalled();
  const copyButton = container.querySelector('.response-pane .json-action-button');
  expect(copyButton.disabled).toBe(false);
  click(copyButton);
  expect(component._copyText).toHaveBeenLastCalledWith('response', JSON.stringify(source, null, 2));
}

test('ordinary responses retain the interactive viewer and legitimate prototype-related keys', () => {
  const source = JSON.parse('{"ok":true,"constructor":null,"__proto__":{"value":1},"prototype":0,"toString":"remote"}');
  const { container, clearLogAndCache } = renderResponse(source);
  expect(container.querySelector('.react-json-view')).not.toBeNull();
  expect(container.querySelector('.response-json-fallback')).toBeNull();
  expect(container.querySelector('.error-boundary')).toBeNull();
  ['ok', 'constructor', '__proto__', 'prototype', 'toString', 'remote'].forEach(text => {
    expect(container.textContent).toContain(text);
  });
  expect(clearLogAndCache).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

test.each([
  ['root numeric property', () => ({ hasOwnProperty: 0, kept: 'complete payload' })],
  ['root null property', () => ({ hasOwnProperty: null, kept: 'complete payload' })],
  ['nested object', () => ({ nested: { hasOwnProperty: 0, kept: 'nested payload' } })],
  ['array member', () => [{ hasOwnProperty: 0, kept: 'array payload' }]],
  ['stream message', () => buildResponseSource(null, null, [{ hasOwnProperty: 0 }], null, false)],
  ['terminal error', () => buildResponseSource(null, { hasOwnProperty: 0 }, null, null, false)],
  ['terminal status', () => buildResponseSource(null, null, null, { hasOwnProperty: 0 }, false)],
])('contains a real renderer failure for %s without dropping captured data or controls', (_, makeSource) => {
  const source = makeSource();
  expect(limitPayload(source)).toBe(source);
  const before = JSON.stringify(source);
  expectContainedFallback(renderResponse(source), source);
  expect(JSON.stringify(source)).toBe(before);
});

test('fallback treats captured HTML as text', () => {
  const source = { hasOwnProperty: 0, markup: '<img src=x onerror="alert(1)"><script>alert(1)</script>' };
  const fixture = renderResponse(source);
  expectContainedFallback(fixture, source);
  expect(fixture.container.querySelector('img, script')).toBeNull();
});

test('expanding a collapsed poisoned descendant stays within the response pane', () => {
  const source = { nested: { hasOwnProperty: 0, kept: 'nested payload' } };
  const fixture = renderResponse(source, 1);
  expect(fixture.container.querySelector('.react-json-view')).not.toBeNull();
  expect(fixture.container.querySelector('.response-json-fallback')).toBeNull();

  const expandButton = fixture.container.querySelectorAll('.response-pane .json-action-button')[2];
  expect(expandButton.textContent).toBe('Expand');
  click(expandButton);
  expectContainedFallback(fixture, source);
});

test('a changed response retries the interactive viewer and still contains subsequent failures', () => {
  const fixture = renderResponse({ hasOwnProperty: 0 });
  expect(fixture.container.querySelector('.response-json-fallback')).not.toBeNull();

  fixture.render({ ok: true, nextResponse: { count: 2 } });
  expect(fixture.container.querySelector('.react-json-view')).not.toBeNull();
  expect(fixture.container.querySelector('.response-json-fallback')).toBeNull();
  expect(fixture.container.textContent).toContain('nextResponse');

  const nextFailure = buildResponseSource(null, null, [{ hasOwnProperty: 0, next: true }], null, false);
  fixture.render(nextFailure);
  expectContainedFallback(fixture, nextFailure);
});
