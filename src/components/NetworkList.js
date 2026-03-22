// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component, createRef } from 'react';
import { connect } from 'react-redux';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List } from 'react-window';
import { setFilterValueDebounced } from '../state/toolbar';
import NetworkListRow from './NetworkListRow';

import './NetworkList.css';

class NetworkList extends Component {
  constructor(props) {
    super(props);
    this.listRef = createRef();
    this.state = {
      localFilterValue: props.filterValue || '',
    };
  }

  componentDidUpdate(prevProps) {
    const { network, filterValue } = this.props;
    const prevLogLength = prevProps.network.log.length;
    const currentLogLength = network.log.length;

    if (prevProps.filterValue !== filterValue && filterValue !== this.state.localFilterValue) {
      this.setState({ localFilterValue: filterValue });
    }

    // New entries were added
    if (currentLogLength > prevLogLength) {
      // Check if we should auto-scroll
      if (this.shouldAutoScroll()) {
        this.scrollToBottom();
      }
    }
  }

  shouldAutoScroll() {
    if (!this.listRef.current) return false;

    const list = this.listRef.current;
    const scrollOffset = list.state.scrollOffset;
    const scrollHeight = this.props.network.log.length * 21; // 21px per row
    const visibleHeight = list.props.height;

    // Auto-scroll if within 100px of bottom (approximately 5 rows)
    const distanceFromBottom = scrollHeight - scrollOffset - visibleHeight;
    return distanceFromBottom < 100;
  }

  scrollToBottom() {
    if (!this.listRef.current) return;

    const { network } = this.props;
    const lastIndex = network.log.length - 1;

    if (lastIndex >= 0) {
      this.listRef.current.scrollToItem(lastIndex, 'end');
    }
  }

  render() {
    const { network, filterIsOpen } = this.props;
    const { localFilterValue } = this.state;
    return (
      <div className="widget vbox network-list">
        {filterIsOpen && (
          <div className="network-list-filter">
            <input
              type="text"
              placeholder="Filter"
              value={localFilterValue}
              onChange={this._onFilterValueChanged}
            />
          </div>
        )}
        <div className="widget vbox">
          <div className="data-grid">
            <div className="header-container">
              <table className="header">
                <tbody>
                  <tr>
                    <th>
                      <div>Name</div>
                    </th>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="data-container">
              <AutoSizer disableWidth>
                {({ height }) => (
                  <List
                    ref={this.listRef}
                    className="data"
                    itemCount={network.log.length}
                    height={height}
                    itemSize={21}
                    itemData={network.log}
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
})
const mapDispatchToProps = { setFilterValueDebounced };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkList)
