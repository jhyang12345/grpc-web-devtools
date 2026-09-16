// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { translate } from '../i18n';
import AuditReportIcon from '../icons/AuditReport';
import { downloadAuditReport } from '../state/auditReport';
import './AuditReportDownload.css';

export class AuditReportDownload extends Component {
  state = { isPreparing: false };

  _isMounted = false;

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  render() {
    const { locale = 'en', hasEntries = false } = this.props;
    const { isPreparing } = this.state;
    const title = hasEntries
      ? translate(locale, 'audit.downloadTitle')
      : translate(locale, 'audit.emptyTitle');

    return (
      <button
        type="button"
        className={`toolbar-button toolbar-item audit-report-button ${isPreparing ? 'is-preparing' : ''}`}
        title={title}
        aria-label={title}
        aria-busy={isPreparing}
        disabled={!hasEntries || isPreparing}
        onClick={this._download}
      >
        <AuditReportIcon />
        <span className="audit-report-label">
          {isPreparing ? translate(locale, 'audit.preparing') : translate(locale, 'audit.download')}
        </span>
      </button>
    );
  }

  _download = async () => {
    if (this.state.isPreparing || !this.props.hasEntries) return;
    this.setState({ isPreparing: true });
    try {
      await this.props.downloadAuditReport();
    } catch (_) {
      // The thunk presents a localized error toast.
    } finally {
      if (this._isMounted) this.setState({ isPreparing: false });
    }
  };
}

const mapStateToProps = state => ({
  // This boolean changes only on first capture/clear, so normal request batches
  // do not force toolbar re-renders or copy the log into component props.
  hasEntries: state.network._allLog.length > 0,
});

const mapDispatchToProps = { downloadAuditReport };

export default connect(mapStateToProps, mapDispatchToProps)(AuditReportDownload);

