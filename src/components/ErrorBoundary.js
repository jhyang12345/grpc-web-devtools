import React, { Component } from 'react';
import { connect } from 'react-redux';
import { clearLogAndCache } from '../state/network';
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
    if (this.state.hasError) {
      return (
        <div className="vbox flex-auto error-boundary">
          <h2 className="error-boundary-title">Something went wrong.</h2>
          <p>The application crashed while rendering. This might be due to a very large or malformed gRPC packet.</p>
          <div className="error-boundary-actions">
            <button
              onClick={this._handleRecover}
              className="error-boundary-recover"
            >
              Clear Logs & Recover
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
