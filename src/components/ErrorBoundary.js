import React, { Component } from 'react';
import { connect } from 'react-redux';
import { clearLogAndCache } from '../state/network';

class ErrorBoundary extends Component {
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
        <div className="vbox flex-auto" style={{ padding: '20px', backgroundColor: '#fffbe6', border: '1px solid #ffe58f', color: 'rgba(0, 0, 0, 0.85)', height: '100%' }}>
          <h2 style={{ color: '#d46b08' }}>Something went wrong.</h2>
          <p>The application crashed while rendering. This might be due to a very large or malformed gRPC packet.</p>
          <div style={{ marginTop: '16px' }}>
            <button
              onClick={this._handleRecover}
              style={{
                padding: '8px 16px',
                backgroundColor: '#faad14',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Clear Logs & Recover
            </button>
          </div>
          {this.state.error && (
            <pre style={{ marginTop: '20px', fontSize: '12px', overflow: 'auto', maxHeight: '200px', backgroundColor: '#fafafa', padding: '10px' }}>
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
