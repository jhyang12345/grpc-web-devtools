// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component, createRef } from 'react';
import { connect } from 'react-redux';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List } from 'react-window';
import { setFilterValueDebounced } from '../state/toolbar';
import { translate } from '../i18n';
import NetworkListRow from './NetworkListRow';

import './NetworkList.css';

const ROW_HEIGHT = 58;
const NEW_ROW_HIGHLIGHT_MS = 400; // slightly longer than the CSS drop-in animation (280ms)

export class NetworkList extends Component {
  constructor(props) {
    super(props);
    this.listRef = createRef();
    this.state = {
      localFilterValue: props.filterValue || '',
      recentlyAddedIds: new Set(),
    };
    this._pendingTimeouts = [];
  }

  componentDidUpdate(prevProps) {
    const { network, filterValue } = this.props;
    const prevLog = prevProps.network.log;
    const currentLog = network.log;

    if (prevProps.filterValue !== filterValue && filterValue !== this.state.localFilterValue) {
      this.setState({ localFilterValue: filterValue });
    }

    if (prevLog !== currentLog) {
      this._trackNewEntries(prevLog, currentLog);
    }

    // New entries were added
    if (currentLog.length > prevLog.length) {
      // Check if we should auto-scroll
      if (this.shouldAutoScroll()) {
        this.scrollToLiveEdge();
      }
    }
  }

  componentWillUnmount() {
    this._pendingTimeouts.forEach(clearTimeout);
  }

  _trackNewEntries(prevLog, currentLog) {
    const prevIds = new Set(prevLog.map(entry => entry.entryId));
    const newlyAddedIds = currentLog
      .map(entry => entry.entryId)
      .filter(entryId => !prevIds.has(entryId));

    if (newlyAddedIds.length === 0) return;

    this.setState(prevState => {
      const recentlyAddedIds = new Set(prevState.recentlyAddedIds);
      newlyAddedIds.forEach(entryId => recentlyAddedIds.add(entryId));
      return { recentlyAddedIds };
    });

    newlyAddedIds.forEach(entryId => {
      const timeoutId = setTimeout(() => {
        this.setState(prevState => {
          if (!prevState.recentlyAddedIds.has(entryId)) return null;
          const recentlyAddedIds = new Set(prevState.recentlyAddedIds);
          recentlyAddedIds.delete(entryId);
          return { recentlyAddedIds };
        });
      }, NEW_ROW_HIGHLIGHT_MS);
      this._pendingTimeouts.push(timeoutId);
    });
  }

  shouldAutoScroll() {
    if (!this.listRef.current) return false;

    const list = this.listRef.current;
    const scrollOffset = list.state.scrollOffset;

    if (this.props.newestFirst !== false) {
      // The live edge is the top; auto-follow only if already near it.
      return scrollOffset < 100;
    }

    const scrollHeight = this.props.network.log.length * ROW_HEIGHT;
    const visibleHeight = list.props.height;

    // Auto-scroll if within a few rows of bottom
    const distanceFromBottom = scrollHeight - scrollOffset - visibleHeight;
    return distanceFromBottom < 100;
  }

  scrollToLiveEdge() {
    if (!this.listRef.current) return;

    if (this.props.newestFirst !== false) {
      this.listRef.current.scrollToItem(0, 'start');
      return;
    }

    const { network } = this.props;
    const lastIndex = network.log.length - 1;

    if (lastIndex >= 0) {
      this.listRef.current.scrollToItem(lastIndex, 'end');
    }
  }

  render() {
    const { network, filterIsOpen, locale = 'en' } = this.props;
    const { localFilterValue, recentlyAddedIds } = this.state;
    const newestFirst = this.props.newestFirst !== false;
    const displayEntries = newestFirst ? network.log.slice().reverse() : network.log;
    return (
      <div className="widget vbox network-list">
        {filterIsOpen && (
          <div className="network-list-filter">
            <input
              type="text"
              placeholder={translate(locale, 'network.filterPlaceholder')}
              value={localFilterValue}
              onChange={this._onFilterValueChanged}
            />
          </div>
        )}
        <div className="widget vbox">
          <div className="data-grid" aria-label={translate(locale, 'network.capturedRequests')}>
            <div className="data-container">
              <AutoSizer disableWidth>
                {({ height }) => (
                  <List
                    ref={this.listRef}
                    className="data"
                    itemCount={displayEntries.length}
                    height={height}
                    itemSize={ROW_HEIGHT}
                    itemKey={(index, data) => data.entries[index].entryId}
                    itemData={{
                      entries: displayEntries,
                      locale,
                      newestFirst,
                      totalCount: network.log.length,
                      recentlyAddedIds,
                    }}
                    overscanCount={15}
                  >
                    {NetworkListRow}
                  </List>
                )}
              </AutoSizer>
            </div>
          </div>
        </div>
      </div>
    );
  }

  _onFilterValueChanged = (event) => {
    const { setFilterValueDebounced } = this.props;
    const newValue = event.target.value;

    this.setState({ localFilterValue: newValue });
    setFilterValueDebounced(newValue);
  };
}

const mapStateToProps = state => ({
  network: state.network,
  filterIsOpen: state.toolbar.filterIsOpen,
  filterValue: state.toolbar.filterValue,
  newestFirst: state.toolbar.newestFirst,
})
const mapDispatchToProps = { setFilterValueDebounced };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkList)
