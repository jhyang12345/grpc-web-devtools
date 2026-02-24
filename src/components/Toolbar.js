// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { setPreserveLog, clearLogAndCache } from '../state/network';
import { toggleFilter, setFilterValue, setFilterValueDebounced, setDefaultCollapsed } from '../state/toolbar';
import { setStorageItem } from '../utils/localStorage';
import ClearIcon from '../icons/Clear';
import FilterIcon from '../icons/Filter';
import RefreshIcon from '../icons/Refresh';
import './Toolbar.css';

class Toolbar extends Component {
  state = {
    localFilterValue: '',
  };

  componentDidUpdate(prevProps) {
    // Sync local state when filter is cleared externally
    const { filterValue } = this.props.toolbar;
    if (filterValue === '' && this.state.localFilterValue !== '') {
      this.setState({ localFilterValue: '' });
    }
  }

  _renderButtons() {
    const { clearLog, toggleFilter, toolbar: { filterIsEnabled, filterIsOpen }} = this.props;
    return (
        <>
          <ToolbarButton title="Clear" onClick={() => clearLog({ force: false })} >
            <ClearIcon />
          </ToolbarButton>
          <ToolbarButton
            title="Force refresh - clears all logs and resets extension state"
            onClick={this._onForceRefresh}
          >
            <RefreshIcon />
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

  _renderFilterToolbar() {
    const { filterIsOpen } = this.props.toolbar;
    const { localFilterValue } = this.state;
    if (filterIsOpen) {
      return (
        <div className="toolbar">
          <div className="toolbar-shadow">
            <span className="toolbar-item text">
              <input
                type="text"
                placeholder="Filter"
                value={localFilterValue}
                onChange={this._onFilterValueChanged}
              />
            </span>
          </div>
        </div>
      );
    }
  }

  render() {
    const { preserveLog, toolbar } = this.props;
    const { isConnected } = toolbar;
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
              title={isConnected ? "DevTools connected" : "DevTools connection lost - try closing and reopening panel"}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                color: isConnected ? '#0a0' : '#f00'
              }}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isConnected ? '#0a0' : '#f00'
              }} />
              {isConnected ? 'Connected' : (
                <>
                  Disconnected
                  <button
                    onClick={this._onReconnect}
                    style={{
                      marginLeft: '8px',
                      padding: '2px 6px',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                    title="Attempt to reconnect to content script"
                  >
                    Reconnect
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
        {this._renderFilterToolbar()}
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

  _onFilterValueChanged = e => {
    const { setFilterValueDebounced } = this.props;
    const newValue = e.target.value;

    // Update local state immediately for responsive UI
    this.setState({ localFilterValue: newValue });

    // Dispatch debounced action for actual filtering
    setFilterValueDebounced(newValue);
  }

  _onForceRefresh = () => {
    const { clearLog, setFilterValue } = this.props;

    // Force clear logs regardless of preserve log setting
    clearLog({ force: true });

    // Clear filter
    setFilterValue('');
    this.setState({ localFilterValue: '' });

    console.log('[gRPC DevTools] Force refresh completed - port will reconnect on next message');
  }

  _onReconnect = () => {
    console.log('[gRPC DevTools] Manual reconnect requested');
    // Send a ping message to content script to trigger port setup
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
      }
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
const mapDispatchToProps = { setPreserveLog, clearLog: clearLogAndCache, toggleFilter, setFilterValue, setFilterValueDebounced, setDefaultCollapsed };
export default connect(mapStateToProps, mapDispatchToProps)(Toolbar);
