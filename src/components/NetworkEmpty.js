// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { translate } from '../i18n';
import './NetworkEmpty.css';

export const CLIENT_INTEGRATION_GUIDE_URL =
  'https://github.com/jhyang12345/grpc-web-devtools/blob/master/docs/client-integration.md';

export function getEmptyStateContent(mode, filterValue, locale = 'en') {
  const modifier = navigator.platform.indexOf('Mac') === 0 ? 'Cmd' : 'Ctrl';

  if (mode === 'filtered-empty') {
    return {
      title: translate(locale, 'network.filteredEmptyTitle'),
      detail: filterValue
        ? translate(locale, 'network.filteredEmptyDetailValue', { filterValue })
        : translate(locale, 'network.filteredEmptyDetail'),
      link: null,
    };
  }

  if (mode === 'no-selection') {
    return {
      title: translate(locale, 'network.noSelectionTitle'),
      detail: translate(locale, 'network.noSelectionDetail'),
      link: null,
    };
  }

  return {
    title: translate(locale, 'network.emptyTitle'),
    detail: translate(locale, 'network.emptyDetail', { modifier }),
    link: {
      href: CLIENT_INTEGRATION_GUIDE_URL,
      label: translate(locale, 'network.setupGuide'),
    },
  };
}

class NetworkEmpty extends PureComponent {
  render() {
    const { mode = 'empty', filterValue = '', locale = 'en' } = this.props;
    const content = getEmptyStateContent(mode, filterValue, locale);

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
