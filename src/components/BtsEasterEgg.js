// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { writeTextToClipboard } from '../utils/clipboard';
import { getNetworkEntry } from '../state/networkCache';
import {
  buildBtsInfoText,
  classifyEnvironment,
  findLatestBuildVersion,
  findLatestOpUserInfo,
  findLatestPageUrl,
  formatLocalTimestamp,
  getChromeVersion,
} from '../utils/btsInfo';
import { fetchBrowserBoundAccount } from '../utils/browserBoundAccount';
import catImage from '../assets/bts-easter-egg-cat.png';
import './BtsEasterEgg.css';

const HIDE_DELAY_MS = 2500;

// A deliberately undocumented shortcut — see docs/ (none, on purpose) and the
// session history that led here. Copies the team's internal bug report
// template's "environment info" block to the clipboard, auto-filled from
// whatever this session has already captured.
export class BtsEasterEgg extends Component {
  state = { visible: false };

  componentDidMount() {
    window.addEventListener('keydown', this._onKeyDown);
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
  }

  _onKeyDown = event => {
    if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.code !== 'KeyB') return;
    event.preventDefault();
    this._trigger();
  };

  _trigger = async () => {
    const { allEntries } = this.props;
    let opUserInfo = findLatestOpUserInfo(allEntries, getNetworkEntry);
    if (!opUserInfo) {
      opUserInfo = await this._fetchOpUserRawFallback();
    }
    // Anyone outside the target user base won't have a captured or fetchable
    // GetOpUser handle. Bail out with zero observable effect (no clipboard
    // write, no cat) rather than a blank/partial BTS block — the chord must
    // look like it does nothing at all to anyone who isn't supposed to know
    // it exists.
    if (!opUserInfo) return;

    const pageUrl = findLatestPageUrl(allEntries);
    const text = buildBtsInfoText({
      url: pageUrl,
      chromeVersion: getChromeVersion(navigator.userAgent),
      timestamp: formatLocalTimestamp(new Date()),
      opUserInfo,
      buildVersion: findLatestBuildVersion(allEntries, getNetworkEntry),
      environment: classifyEnvironment(pageUrl),
    });

    try {
      await writeTextToClipboard(text);
    } catch (_) {
      // No visible UI to report a clipboard failure through — this is
      // best-effort by design, same as the raw-fetch fallback below.
    }
    this._showCat();
  };

  // A browser-observed credential is bound to its API origin. Page capture
  // entries never choose the target or supply credentials for this fallback.
  _fetchOpUserRawFallback = async () => {
    try {
      const result = await fetchBrowserBoundAccount();
      if (!result) return null;

      return { email: result.email, company: result.operatorFullName, role: result.role };
    } catch (_) {
      return null;
    }
  };

  _showCat = () => {
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
    this.setState({ visible: true });
    this._hideTimeout = setTimeout(() => {
      this.setState({ visible: false });
    }, HIDE_DELAY_MS);
  };

  render() {
    if (!this.state.visible) return null;
    return (
      <div className="bts-easter-egg" aria-hidden="true">
        <img src={catImage} alt="" className="bts-easter-egg-image" />
      </div>
    );
  }
}

const mapStateToProps = state => ({ allEntries: state.network._allLog });
export default connect(mapStateToProps)(BtsEasterEgg);
