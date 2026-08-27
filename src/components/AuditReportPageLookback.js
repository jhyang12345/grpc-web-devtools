// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { translate } from '../i18n';
import { MAX_AUDIT_PAGE_LOOKBACK, MIN_AUDIT_PAGE_LOOKBACK } from '../utils/auditReport';
import { setAuditReportPageLookbackAndPersist } from '../state/auditReport';
import './AuditReportPageLookback.css';

const PAGE_LOOKBACK_OPTIONS = Array.from(
  { length: MAX_AUDIT_PAGE_LOOKBACK - MIN_AUDIT_PAGE_LOOKBACK + 1 },
  (_, index) => MIN_AUDIT_PAGE_LOOKBACK + index,
);

export class AuditReportPageLookback extends Component {
  render() {
    const { locale = 'en', pageLookback, setAuditReportPageLookbackAndPersist } = this.props;
    const title = translate(locale, 'audit.pageLookbackTitle');

    return (
      <label className="toolbar-item audit-report-pages" title={title}>
        <span className="audit-report-pages-label">{translate(locale, 'audit.pageLookbackLabel')}</span>
        <select
          className="audit-report-pages-select"
          aria-label={title}
          value={pageLookback}
          onChange={event => setAuditReportPageLookbackAndPersist(Number(event.target.value))}
        >
          {PAGE_LOOKBACK_OPTIONS.map(value => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
    );
  }
}

const mapStateToProps = state => ({
  pageLookback: state.auditReport.pageLookback,
});

const mapDispatchToProps = { setAuditReportPageLookbackAndPersist };

export default connect(mapStateToProps, mapDispatchToProps)(AuditReportPageLookback);
