import React from 'react';
import { Toolbar } from '../components/Toolbar';
import AuditReportDownload from '../components/AuditReportDownload';
import AuditReportPageLookback from '../components/AuditReportPageLookback';
import SettingsPopover from '../components/SettingsPopover';

const buttons = node => {
  if (!node || typeof node !== 'object') return [];
  const children = React.Children.toArray(node.props && node.props.children);
  return [(node.type === 'button' ? node : null), ...children.flatMap(buttons)].filter(Boolean);
};

const findByClassToken = (node, className) => {
  if (!node || typeof node !== 'object') return null;
  const classNames = String(node.props?.className || '').split(/\s+/);
  if (classNames.includes(className)) return node;
  return React.Children.toArray(node.props?.children)
    .map(child => findByClassToken(child, className))
    .find(Boolean) || null;
};

test.each(['pending', 'disconnected'])('toolbar offers manual reconnect while %s', connectionStatus => {
  const tree = new Toolbar({
    toolbar: { connectionStatus, filterIsEnabled: false, filterIsOpen: true, defaultCollapsed: false },
    preserveLog: false,
    clearLog: jest.fn(),
    toggleFilter: jest.fn(),
    setPreserveLog: jest.fn(),
    setDefaultCollapsed: jest.fn(),
    setConnectionStatus: jest.fn(),
  }).render();
  expect(buttons(tree).some(button => button.props.className === 'reconnect-button')).toBe(true);
});

test('toolbar clear is forceful', () => {
  const clearLog = jest.fn();
  const toolbar = new Toolbar({
    toolbar: { connectionStatus: 'connected', filterIsEnabled: false, filterIsOpen: true, defaultCollapsed: false },
    preserveLog: true, clearLog, toggleFilter: jest.fn(), setPreserveLog: jest.fn(), setDefaultCollapsed: jest.fn(), setConnectionStatus: jest.fn(),
  });
  const clearButton = React.Children.toArray(toolbar._renderButtons().props.children).find(button => button.props.title === 'Clear log history');
  clearButton.props.onClick();
  expect(clearLog).toHaveBeenCalledWith({ force: true });
});

test('toolbar keeps primary and right-docked controls in responsive groups', () => {
  const tree = new Toolbar({
    toolbar: { connectionStatus: 'pending', filterIsEnabled: false, filterIsOpen: true, defaultCollapsed: false },
    preserveLog: false,
    clearLog: jest.fn(),
    toggleFilter: jest.fn(),
    setPreserveLog: jest.fn(),
    setDefaultCollapsed: jest.fn(),
    setConnectionStatus: jest.fn(),
  }).render();
  const main = findByClassToken(tree, 'toolbar-main');
  const actions = findByClassToken(tree, 'toolbar-actions');
  const connection = findByClassToken(main, 'toolbar-connection');
  const actionChildren = React.Children.toArray(actions.props.children);

  expect(main).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(connection).not.toBeNull();
  expect(actionChildren).toHaveLength(6);
  expect(actionChildren[1].type).toBe(AuditReportPageLookback);
  expect(actionChildren[3].type).toBe(AuditReportDownload);
  expect(actionChildren[5].type).toBe(SettingsPopover);
  const dividerType = actionChildren[0].type;
  [0, 2, 4].forEach(index => {
    expect(actionChildren[index].type).toBe(dividerType);
  });
  const renderedDivider = new dividerType({}).render();
  expect(renderedDivider.props.className).toContain('toolbar-divider');
  expect(renderedDivider.props['aria-hidden']).toBe('true');
});
