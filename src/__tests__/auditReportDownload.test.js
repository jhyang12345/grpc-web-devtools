import React from 'react';
import { AuditReportDownload } from '../components/AuditReportDownload';

test('disables audit download until at least one request is retained', () => {
  const empty = new AuditReportDownload({ locale: 'en', hasEntries: false, downloadAuditReport: jest.fn() }).render();
  expect(empty.props.disabled).toBe(true);
  expect(empty.props.title).toMatch(/Capture requests/i);

  const ready = new AuditReportDownload({ locale: 'en', hasEntries: true, downloadAuditReport: jest.fn() }).render();
  expect(ready.props.disabled).toBe(false);
  expect(React.Children.toArray(ready.props.children)[1].props.children).toBe('Audit report');
});

test('preparing state prevents duplicate downloads and exposes aria-busy', () => {
  const component = new AuditReportDownload({ locale: 'en', hasEntries: true, downloadAuditReport: jest.fn() });
  component.state = { isPreparing: true };
  const tree = component.render();
  expect(tree.props.disabled).toBe(true);
  expect(tree.props['aria-busy']).toBe(true);
});

