// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import { connect } from 'react-redux';
import Split from 'react-split';
import './MainLayout.css';
import NetworkDetails from './NetworkDetails';
import NetworkEmpty from './NetworkEmpty';
import NetworkList from './NetworkList';

class MainLayout extends Component {
  _renderDetailsPane() {
    const { hasVisibleEntries, hasCapturedEntries, filterValue, hasSelectedEntry } = this.props;

    if (!hasVisibleEntries) {
      return (
        <NetworkEmpty
          mode={hasCapturedEntries ? 'filtered-empty' : 'empty'}
          filterValue={filterValue}
        />
      );
    }

    if (!hasSelectedEntry) {
      return <NetworkEmpty mode="no-selection" />;
    }

    return <NetworkDetails />;
  }

  render() {
    return (
      <div className="vbox flex-auto">
        <div className="shadow-split-widget hbox widget">
          <Split
            className="hbox flex-auto main-layout-split"
            sizes={[30, 70]}
            gutterSize={5}
            cursor="ew-resize"
          >
            <div className="main-layout-pane main-layout-pane-list">
              <NetworkList />
            </div>
            <div className="main-layout-pane main-layout-pane-details">
              {this._renderDetailsPane()}
            </div>
          </Split>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state) => ({
  hasVisibleEntries: state.network.log.length > 0,
  hasCapturedEntries: state.network._allLog.length > 0,
  hasSelectedEntry: !!state.network.selectedEntry,
  filterValue: state.toolbar.filterValue,
});

export default connect(mapStateToProps)(MainLayout);
