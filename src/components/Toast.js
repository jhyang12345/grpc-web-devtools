// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { hideToast } from '../state/toast';
import './Toast.css';

class Toast extends Component {
  componentDidUpdate(prevProps) {
    const { visible, autoDismiss, hideToast } = this.props;

    // Start auto-dismiss timer when toast becomes visible
    if (visible && !prevProps.visible && autoDismiss) {
      if (this.dismissTimer) {
        clearTimeout(this.dismissTimer);
      }

      this.dismissTimer = setTimeout(() => {
        hideToast();
      }, autoDismiss);
    }

    // Clear timer when toast is hidden
    if (!visible && prevProps.visible) {
      if (this.dismissTimer) {
        clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
      }
    }
  }

  componentWillUnmount() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
    }
  }

  render() {
    const { visible, message, type } = this.props;

    if (!visible) {
      return null;
    }

    return (
      <div className={`toast toast-${type} ${visible ? 'toast-visible' : ''}`}>
        <div className="toast-content">
          {type === 'success' && (
            <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16">
              <path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5 9-9z" />
            </svg>
          )}
          <span className="toast-message">{message}</span>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  visible: state.toast.visible,
  message: state.toast.message,
  type: state.toast.type,
  autoDismiss: state.toast.autoDismiss,
});

const mapDispatchToProps = { hideToast };

export default connect(mapStateToProps, mapDispatchToProps)(Toast);
