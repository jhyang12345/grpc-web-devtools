// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setPreserveLog, clearLogAndCache } from '../state/network';
import { toggleFilter, setDefaultCollapsed, setConnectionStatus } from '../state/toolbar';
import { setStorageItem } from '../utils/localStorage';
import TrashIcon from '../icons/Trash';
import FilterIcon from '../icons/Filter';
import './Toolbar.css';

export class Toolbar extends Component {
  _renderButtons() {
    const { clearLog, toggleFilter, toolbar: { filterIsEnabled, filterIsOpen }} = this.props;
    return (
        <>
          <ToolbarButton title="Clear log history" onClick={() => clearLog({ force: true })} >
            <TrashIcon />
          </ToolbarButton>
          <ToolbarButton
            title="Filter"
            onClick={() => toggleFilter()}
            className={(filterIsOpen ? "open " : "") + (filterIsEnabled ? "enabled" : "")}
           >
             <FilterIcon />
           </ToolbarButton>
        </>
    )
  }

  render() {
    const { preserveLog, toolbar } = this.props;
    const { connectionStatus } = toolbar;
    const statusColor = connectionStatus === 'connected' ? '#0a0' : connectionStatus === 'pending' ? '#fa0' : '#f00';
    const statusTitle = connectionStatus === 'connected'
      ? "DevTools connected"
      : connectionStatus === 'pending'
        ? "Waiting for content script registration; automatic recovery is active"
        : "DevTools connection lost; automatic recovery is active";
    return (
      <>
        <div className="toolbar">
          <div className="toolbar-shadow">
            {this._renderButtons()}
            <ToolbarDivider />
            <span className="toolbar-item checkbox" title="Do not clear log on page reload / navigation">
              <input
                type="checkbox"
                id="ui-checkbox-preserve-log"
                checked={preserveLog}
                onChange={this._onPreserveLogChanged}
              />
              <label htmlFor="ui-checkbox-preserve-log">Preserve log</label>
            </span>
            <ToolbarDivider />
            <span className="toolbar-item checkbox" title="Collapse JSON details by default when selecting entries">
              <input
                type="checkbox"
                id="ui-checkbox-default-collapsed"
                checked={toolbar.defaultCollapsed}
                onChange={this._onDefaultCollapsedChanged}
              />
              <label htmlFor="ui-checkbox-default-collapsed">Collapsed</label>
            </span>
            <ToolbarDivider />
            <span
              className="toolbar-item"
              title={statusTitle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                color: statusColor
              }}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusColor
              }} />
              {connectionStatus === 'connected' ? 'Connected' : (
                <>
                  {connectionStatus === 'pending' ? 'Connecting...' : 'Disconnected'}
                  <button
                    onClick={this._onReconnect}
                    className="reconnect-button"
                    title="Restart the automatic connection recovery now"
                  >
                    Reconnect
                  </button>
                </>
              )}
            </span>
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
      <div className="toolbar-item toolbar-divider" />
    );
  }
}

class ToolbarButton extends Component {
  render() {
    const { children, className = "", ...other } = this.props;
    return (
      <button className={"toolbar-button toolbar-item " + className} {...other}>
        {children}
      </button>
    );
  }
}

const mapStateToProps = state => ({
  preserveLog: state.network.preserveLog,
  toolbar: state.toolbar,
});
const mapDispatchToProps = { setPreserveLog, clearLog: clearLogAndCache, toggleFilter, setDefaultCollapsed, setConnectionStatus };
export default connect(mapStateToProps, mapDispatchToProps)(Toolbar);
