// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { writeTextToClipboard } from '../utils/clipboard';
import { getNetworkEntry } from '../state/networkCache';
import {
  buildBtsInfoText,
  classifyEnvironment,
  findLatestBackendOrigin,
  findLatestBuildVersion,
  findLatestOpUserInfo,
  findLatestPageUrl,
  formatLocalTimestamp,
  getChromeVersion,
} from '../utils/btsInfo';
import { buildOpUserEvalExpression } from '../utils/opUserRawFetch';
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
      opUserInfo = await this._fetchOpUserRawFallback(allEntries);
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

  // Our extension only observes calls the inspected app's own gRPC client
  // makes (see public/protobuf-ts-interceptor.js) — it has no client of its
  // own. If GetOpUser wasn't captured this session, this bypasses that
  // entirely via a minimal hand-rolled gRPC-Web request run inside the
  // inspected page (so its cookies/session apply). Any failure at any layer
  // must resolve to null so the caller falls back to a blank field.
  _fetchOpUserRawFallback = async allEntries => {
    try {
      if (typeof chrome === 'undefined' || !chrome.devtools?.inspectedWindow?.eval) return null;
      const backendOrigin = findLatestBackendOrigin(allEntries);
      if (!backendOrigin) return null;

      const expression = buildOpUserEvalExpression(backendOrigin);
      const result = await new Promise(resolve => {
        chrome.devtools.inspectedWindow.eval(expression, (value, exceptionInfo) => {
          resolve(exceptionInfo ? null : value);
        });
      });
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
