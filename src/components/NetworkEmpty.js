// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import './NetworkEmpty.css';

export const CLIENT_INTEGRATION_GUIDE_URL =
  'https://github.com/jhyang12345/grpc-web-devtools/blob/master/docs/client-integration.md';

export function getEmptyStateContent(mode, filterValue) {
  const modifier = navigator.platform.indexOf('Mac') === 0 ? 'Cmd' : 'Ctrl';

  if (mode === 'filtered-empty') {
    return {
      title: 'No requests match the current filter.',
      detail: filterValue
        ? `Update or clear "${filterValue}" to show captured requests again.`
        : 'Update or clear the current filter to show captured requests again.',
      link: null,
    };
  }

  if (mode === 'no-selection') {
    return {
      title: 'Select a request to inspect, edit, or replay it.',
      detail: 'Choose a captured request from the list to inspect its details or edit its JSON before replaying it.',
      link: null,
    };
  }

  return {
    title: 'Inspecting gRPC network activity...',
    detail: `Perform a request or reload with ${modifier} R to capture it, then select it to inspect or replay it.`,
    link: {
      href: CLIENT_INTEGRATION_GUIDE_URL,
      label: 'Set up your web application',
    },
  };
}

class NetworkEmpty extends PureComponent {
  render() {
    const { mode = 'empty', filterValue = '' } = this.props;
    const content = getEmptyStateContent(mode, filterValue);

    return (
      <div className="network-empty">
        <div className="content">
          <div className="network-empty-title">{content.title}</div>
          <div className="network-empty-detail">{content.detail}</div>
          {content.link && (
            <div className="network-empty-help">
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={content.link.href}
              >
                {content.link.label}
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default NetworkEmpty;
