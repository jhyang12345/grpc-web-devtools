// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from 'react';
import packageInfo from '../../package.json';
import { translate } from '../i18n';
import SettingsIcon from '../icons/Settings';
import './SettingsPopover.css';

const OPTIONS = [
  { value: 'auto', labelKey: 'settings.auto' },
  { value: 'en', labelKey: 'settings.english' },
  { value: 'ko', labelKey: 'settings.korean' },
];

const packageVersion = packageInfo.version;

export function getExtensionVersion() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version || packageVersion;
    }
  } catch (_) {}
  return packageVersion;
}

export class SettingsPopover extends Component {
  state = { isOpen: false };

  rootRef = React.createRef();

  buttonRef = React.createRef();

  firstOptionRef = React.createRef();

  componentDidMount() {
    document.addEventListener('mousedown', this._handleDocumentPointer, true);
    document.addEventListener('keydown', this._handleDocumentKeydown, true);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this._handleDocumentPointer, true);
    document.removeEventListener('keydown', this._handleDocumentKeydown, true);
  }

  render() {
    const { locale = 'en', preference = 'auto' } = this.props;
    const { isOpen } = this.state;
    const version = this.props.version || getExtensionVersion();

    return (
      <div className="settings-control" ref={this.rootRef}>
        <span className="settings-version-label">v{version}</span>
        <button
          ref={this.buttonRef}
          type="button"
          className={`toolbar-button toolbar-item settings-button ${isOpen ? 'open' : ''}`}
          title={translate(locale, 'toolbar.settingsTitle')}
          aria-label={translate(locale, 'toolbar.settingsTitle')}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={this._toggle}
        >
          <SettingsIcon />
        </button>
        {isOpen && (
          <div className="settings-popover" role="dialog" aria-label={translate(locale, 'toolbar.settingsTitle')}>
            <div className="settings-popover-header">
              <span>{translate(locale, 'settings.language')}</span>
              <button
                type="button"
                className="settings-close"
                aria-label={translate(locale, 'settings.close')}
                title={translate(locale, 'settings.close')}
                onClick={() => this._close(true)}
              >×</button>
            </div>
            <div className="settings-options" role="radiogroup" aria-label={translate(locale, 'settings.language')}>
              {OPTIONS.map((option, index) => (
                <label className="settings-option" key={option.value}>
                  <input
                    ref={index === 0 ? this.firstOptionRef : null}
                    type="radio"
                    name="language-preference"
                    value={option.value}
                    checked={preference === option.value}
                    onChange={this._selectLanguage}
                  />
                  <span>{translate(locale, option.labelKey)}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  _toggle = () => {
    this.setState(prevState => ({ isOpen: !prevState.isOpen }), () => {
      if (this.state.isOpen) this.firstOptionRef.current?.focus();
    });
  };

  _close = (restoreFocus = false) => {
    this.setState({ isOpen: false }, () => {
      if (restoreFocus) this.buttonRef.current?.focus();
    });
  };

  _selectLanguage = event => {
    this.props.onLanguageChange(event.target.value);
  };

  _handleDocumentPointer = event => {
    if (this.state.isOpen && !this.rootRef.current?.contains(event.target)) this._close();
  };

  _handleDocumentKeydown = event => {
    if (this.state.isOpen && event.key === 'Escape') {
      event.preventDefault();
      this._close(true);
    }
  };
}

export default SettingsPopover;
