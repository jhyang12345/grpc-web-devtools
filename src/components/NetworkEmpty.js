// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import './NetworkEmpty.css';

function getEmptyStateContent(mode, filterValue) {
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
      title: 'Select a request to inspect its payload.',
      detail: 'Choose any request from the list to view or retry it.',
      link: null,
    };
  }

  return {
    title: 'Recording gRPC network activity...',
    detail: `Perform a request or hit ${modifier} R to record the reload.`,
    link: null,
  };
}

class NetworkEmpty extends PureComponent {
  render() {
    const { mode = 'empty', filterValue = '' } = this.props;
    const content = getEmptyStateContent(mode, filterValue);

    return (
      <div className="network-empty">
        <div className="content">
          <div>{content.title}</div>
          <div>{content.detail}</div>
          {content.link && (
            <div>
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
