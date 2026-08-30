// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setPreserveLog, clearLogAndCache } from '../state/network';
import { toggleFilter, setDefaultCollapsed, setConnectionStatus } from '../state/toolbar';
import { setStorageItem } from '../utils/localStorage';
import { translate } from '../i18n';
import { setLanguagePreferenceAndPersist } from '../state/localization';
import TrashIcon from '../icons/Trash';
import FilterIcon from '../icons/Filter';
import SettingsPopover from './SettingsPopover';
import AuditReportDownload from './AuditReportDownload';
import AuditReportPageLookback from './AuditReportPageLookback';
import './Toolbar.css';

export class Toolbar extends Component {
  _renderButtons() {
    const { clearLog, toggleFilter, locale = 'en', toolbar: { filterIsEnabled, filterIsOpen }} = this.props;
    return (
        <>
          <ToolbarButton title={translate(locale, 'toolbar.clearLogTitle')} onClick={() => clearLog({ force: true })} >
            <TrashIcon />
          </ToolbarButton>
          <ToolbarButton
            title={translate(locale, 'toolbar.filterTitle')}
            onClick={() => toggleFilter()}
            className={(filterIsOpen ? "open " : "") + (filterIsEnabled ? "enabled" : "")}
           >
             <FilterIcon />
           </ToolbarButton>
        </>
    )
  }

  render() {
    const { preserveLog, toolbar, locale = 'en', languagePreference = 'auto' } = this.props;
    const { connectionStatus } = toolbar;
    const statusTitle = connectionStatus === 'connected'
      ? translate(locale, 'toolbar.connectedTitle')
      : connectionStatus === 'pending'
        ? translate(locale, 'toolbar.pendingTitle')
        : translate(locale, 'toolbar.disconnectedTitle');
    return (
      <>
        <div className="toolbar">
          <div className="toolbar-shadow">
            <div className="toolbar-main">
              {this._renderButtons()}
              <ToolbarDivider />
              <span className="toolbar-item checkbox" title={translate(locale, 'toolbar.preserveLogTitle')}>
                <input
                  type="checkbox"
                  id="ui-checkbox-preserve-log"
                  checked={preserveLog}
                  onChange={this._onPreserveLogChanged}
                />
                <label htmlFor="ui-checkbox-preserve-log">{translate(locale, 'toolbar.preserveLog')}</label>
              </span>
              <ToolbarDivider />
              <span className="toolbar-item checkbox" title={translate(locale, 'toolbar.collapsedTitle')}>
                <input
                  type="checkbox"
                  id="ui-checkbox-default-collapsed"
                  checked={toolbar.defaultCollapsed}
                  onChange={this._onDefaultCollapsedChanged}
                />
                <label htmlFor="ui-checkbox-default-collapsed">{translate(locale, 'toolbar.collapsed')}</label>
              </span>
              <div className="toolbar-connection">
                <ToolbarDivider />
                <span
                  className={`toolbar-item connection-status connection-status--${connectionStatus}`}
                  title={statusTitle}
                >
                  <span className="connection-status-dot" />
                  {connectionStatus === 'connected' ? translate(locale, 'toolbar.connected') : (
                    <>
                      {connectionStatus === 'pending'
                        ? translate(locale, 'toolbar.connecting')
                        : translate(locale, 'toolbar.disconnected')}
                      <button
                        type="button"
                        onClick={this._onReconnect}
                        className="reconnect-button"
                        title={translate(locale, 'toolbar.reconnectTitle')}
                      >
                        {translate(locale, 'toolbar.reconnect')}
                      </button>
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="toolbar-actions">
              <ToolbarDivider />
              <AuditReportPageLookback locale={locale} />
              <ToolbarDivider />
              <AuditReportDownload locale={locale} />
              <ToolbarDivider />
              <SettingsPopover
                locale={locale}
                preference={languagePreference}
                onLanguageChange={this.props.setLanguagePreferenceAndPersist}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  _onPreserveLogChanged = e => {
    const { setPreserveLog } = this.props;
    setPreserveLog(e.target.checked);
  }

  _onDefaultCollapsedChanged = e => {
    const { setDefaultCollapsed } = this.props;
    const newValue = e.target.checked;

    // Update Redux state
    setDefaultCollapsed(newValue);

    // Persist to localStorage
    setStorageItem('defaultCollapsed', newValue);
  }

  _onReconnect = () => {
    this.props.setConnectionStatus('pending');

    if (window.setupPanelPortIfNeeded) {
      window.setupPanelPortIfNeeded();
    } else {
      console.error('[gRPC DevTools] setupPanelPortIfNeeded not available');
    }

    const tabId = chrome.devtools && chrome.devtools.inspectedWindow && chrome.devtools.inspectedWindow.tabId;
    if (typeof tabId !== 'number') return;
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, () => {
      if (chrome.runtime.lastError) console.error('[gRPC DevTools] Ping failed:', chrome.runtime.lastError.message);
    });
  }
}

class ToolbarDivider extends Component {
  render() {
    return (
      <div className="toolbar-item toolbar-divider" aria-hidden="true" />
    );
  }
}

class ToolbarButton extends Component {
  render() {
    const { children, className = "", ...other } = this.props;
    return (
      <button type="button" className={"toolbar-button toolbar-item " + className} {...other}>
        {children}
      </button>
    );
  }
}

const mapStateToProps = state => ({
  preserveLog: state.network.preserveLog,
  toolbar: state.toolbar,
  languagePreference: state.localization.preference,
});
const mapDispatchToProps = {
  setPreserveLog,
  clearLog: clearLogAndCache,
  toggleFilter,
  setDefaultCollapsed,
  setConnectionStatus,
  setLanguagePreferenceAndPersist,
};
export default connect(mapStateToProps, mapDispatchToProps)(Toolbar);
