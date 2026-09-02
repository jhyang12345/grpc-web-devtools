// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { translate } from '../i18n';
import './DebugReportCopy.css';

export class DebugReportCopy extends Component {
  state = { isOpen: false };

  rootRef = React.createRef();

  menuButtonRef = React.createRef();

  itemRefs = [React.createRef(), React.createRef()];

  componentDidMount() {
    document.addEventListener('mousedown', this._handleDocumentPointer, true);
    document.addEventListener('keydown', this._handleDocumentKeydown, true);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this._handleDocumentPointer, true);
    document.removeEventListener('keydown', this._handleDocumentKeydown, true);
  }

  render() {
    const { locale = 'en' } = this.props;
    const { isOpen } = this.state;
    const warning = translate(locale, 'copy.reportSensitiveWarning');

    return (
      <div className="debug-report-copy" ref={this.rootRef}>
        <div className="debug-report-split" role="group" aria-label={translate(locale, 'copy.reportAria')}>
          <button
            type="button"
            className="debug-report-main"
            title={warning}
            onClick={() => this._copy('markdown')}
          >
            {translate(locale, 'copy.report')}
          </button>
          <button
            ref={this.menuButtonRef}
            type="button"
            className={`debug-report-menu-button ${isOpen ? 'is-open' : ''}`}
            title={translate(locale, 'copy.chooseFormat')}
            aria-label={translate(locale, 'copy.chooseFormat')}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            onClick={this._toggleMenu}
          >
            <span aria-hidden="true">▾</span>
          </button>
        </div>
        {isOpen && (
          <div className="debug-report-menu" role="menu" onKeyDown={this._handleMenuKeydown}>
            <button
              ref={this.itemRefs[0]}
              type="button"
              role="menuitem"
              onClick={() => this._copy('markdown')}
            >
              {translate(locale, 'copy.asMarkdown')}
            </button>
            <button
              ref={this.itemRefs[1]}
              type="button"
              role="menuitem"
              onClick={() => this._copy('json')}
            >
              {translate(locale, 'copy.asJson')}
            </button>
            <div className="debug-report-warning" role="note">{warning}</div>
          </div>
        )}
      </div>
    );
  }

  _copy = format => {
    this.setState({ isOpen: false });
    this.props.onCopy(format);
  };

  _toggleMenu = () => {
    this.setState(prevState => ({ isOpen: !prevState.isOpen }), () => {
      if (this.state.isOpen) this.itemRefs[0].current?.focus();
    });
  };

  _closeMenu = (restoreFocus = false) => {
    this.setState({ isOpen: false }, () => {
      if (restoreFocus) this.menuButtonRef.current?.focus();
    });
  };

  _handleDocumentPointer = event => {
    if (this.state.isOpen && !this.rootRef.current?.contains(event.target)) this._closeMenu();
  };

  _handleDocumentKeydown = event => {
    if (this.state.isOpen && event.key === 'Escape') {
      event.preventDefault();
      this._closeMenu(true);
    }
  };

  _handleMenuKeydown = event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const currentIndex = this.itemRefs.findIndex(ref => ref.current === document.activeElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (Math.max(currentIndex, 0) + direction + this.itemRefs.length) % this.itemRefs.length;
    this.itemRefs[nextIndex].current?.focus();
  };
}

export default DebugReportCopy;

