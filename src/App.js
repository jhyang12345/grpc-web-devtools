
import React, { Component } from 'react';
import { connect } from 'react-redux';
import './App.css';
import MainLayout from './components/MainLayout';
import Toolbar from './components/Toolbar';
import ErrorBoundary from './components/ErrorBoundary';
import Toast from './components/Toast';
import { detectBrowserLocale, translate } from './i18n';
import { selectLocale, setBrowserLocale } from './state/localization';


class App extends Component {
  componentDidMount() {
    this._applyLocale();
    window.addEventListener('languagechange', this._handleLanguageChange);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.locale !== this.props.locale) this._applyLocale();
  }

  componentWillUnmount() {
    window.removeEventListener('languagechange', this._handleLanguageChange);
  }

  render() {
    const { locale } = this.props;
    return (
      <ErrorBoundary locale={locale}>
        <div className="vbox flex-auto">
          <div className="hbox widget">
            <div className="vbox app-contents flex-auto">
              <div className="vbox widget">
                <div className="vbox flex-auto">
                  <div className="widget vbox">
                    <Toolbar locale={locale} />
                    <MainLayout locale={locale} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <Toast />
      </ErrorBoundary>
    );
  }

  _applyLocale = () => {
    const { locale } = this.props;
    document.documentElement.lang = locale;
    document.title = translate(locale, 'app.title');
  };

  _handleLanguageChange = () => {
    this.props.setBrowserLocale(detectBrowserLocale());
  };
}

const mapStateToProps = state => ({ locale: selectLocale(state) });
const mapDispatchToProps = { setBrowserLocale };
export default connect(mapStateToProps, mapDispatchToProps)(App);
