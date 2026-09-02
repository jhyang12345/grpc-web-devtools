import React, { Component } from 'react';
import { connect } from 'react-redux';
import { clearLogAndCache } from '../state/network';
import { translate } from '../i18n';
import './ErrorBoundary.css';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  _handleRecover = () => {
    const { clearLogAndCache } = this.props;
    // Clear everything to ensure we start from a clean state
    clearLogAndCache({ force: true });
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { locale = 'en' } = this.props;
    if (this.state.hasError) {
      return (
        <div className="vbox flex-auto error-boundary">
          <h2 className="error-boundary-title">{translate(locale, 'error.title')}</h2>
          <p>{translate(locale, 'error.detail')}</p>
          <div className="error-boundary-actions">
            <button
              onClick={this._handleRecover}
              className="error-boundary-recover"
            >
              {translate(locale, 'error.recover')}
            </button>
          </div>
          {this.state.error && (
            <pre className="error-boundary-details">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

const mapDispatchToProps = { clearLogAndCache };
export default connect(null, mapDispatchToProps)(ErrorBoundary);
