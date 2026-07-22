import React from 'react';
import { Toolbar } from '../components/Toolbar';

const buttons = node => {
  if (!node || typeof node !== 'object') return [];
  const children = React.Children.toArray(node.props && node.props.children);
  return [(node.type === 'button' ? node : null), ...children.flatMap(buttons)].filter(Boolean);
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
