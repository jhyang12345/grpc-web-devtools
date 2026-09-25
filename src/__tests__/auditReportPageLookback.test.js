import React from 'react';
import { AuditReportPageLookback } from '../components/AuditReportPageLookback';

test('renders the persisted page lookback and offers all 1-5 choices', () => {
  const tree = new AuditReportPageLookback({
    locale: 'en',
    pageLookback: 3,
    setAuditReportPageLookbackAndPersist: jest.fn(),
  }).render();
  const select = React.Children.toArray(tree.props.children)[1];

  expect(select.props.value).toBe(3);
  expect(React.Children.toArray(select.props.children).map(option => option.props.value)).toEqual([1, 2, 3, 4, 5]);
});

test('changing the selection persists the new page lookback', () => {
  const setAuditReportPageLookbackAndPersist = jest.fn();
  const tree = new AuditReportPageLookback({
    locale: 'en',
    pageLookback: 2,
    setAuditReportPageLookbackAndPersist,
  }).render();
  const select = React.Children.toArray(tree.props.children)[1];

  select.props.onChange({ target: { value: '5' } });
  expect(setAuditReportPageLookbackAndPersist).toHaveBeenCalledWith(5);
});
