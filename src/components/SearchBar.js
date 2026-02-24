// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import './SearchBar.css';

class SearchBar extends Component {
  inputRef = React.createRef();

  componentDidMount() {
    // Auto-focus input when search bar appears
    if (this.inputRef.current) {
      this.inputRef.current.focus();
    }
  }

  render() {
    const { query, matchCount, currentIndex, onChange, onNext, onPrev, onClose } = this.props;

    return (
      <div className="search-bar">
        <input
          ref={this.inputRef}
          type="text"
          className="search-input"
          placeholder="Search JSON..."
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={this._handleKeyDown}
        />
        <span className="search-matches">
          {matchCount > 0 ? `${currentIndex + 1} of ${matchCount}` : 'No matches'}
        </span>
        <button
          className="search-nav-btn"
          onClick={onPrev}
          disabled={matchCount === 0}
          title="Previous match (Shift + Enter)"
        >
          ↑
        </button>
        <button
          className="search-nav-btn"
          onClick={onNext}
          disabled={matchCount === 0}
          title="Next match (Enter)"
        >
          ↓
        </button>
        <button
          className="search-close-btn"
          onClick={onClose}
          title="Close search (Esc)"
        >
          ✕
        </button>
      </div>
    );
  }

  _handleKeyDown = (e) => {
    const { onNext, onPrev, onClose } = this.props;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev(); // Shift + Enter = previous match
      } else {
        onNext(); // Enter = next match (or trigger search if new query)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
}

export default SearchBar;
