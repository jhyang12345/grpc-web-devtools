// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from "react";
import "./SearchBar.css";

class SearchBar extends Component {
  inputRef = React.createRef();

  componentDidMount() {
    if (this.inputRef.current) {
      this.inputRef.current.focus();
      this.inputRef.current.select();
    }
  }

  render() {
    const {
      compact,
      placeholder = "Search JSON",
      query,
      matchCount,
      currentIndex,
      onChange,
      onNext,
      onPrev,
      onClose,
    } = this.props;

    const classes = `search-bar ${compact ? "search-bar-compact" : ""}`.trim();

    return (
      <div className={classes}>
        <input
          ref={this.inputRef}
          type="text"
          className="search-input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={this._handleKeyDown}
        />
        <span className="search-matches">
          {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0"}
        </span>
        <button
          className="search-btn"
          onClick={onPrev}
          disabled={matchCount === 0}
          title="Previous match"
        >
          Prev
        </button>
        <button
          className="search-btn"
          onClick={onNext}
          disabled={matchCount === 0}
          title="Next match"
        >
          Next
        </button>
        <button
          className="search-btn"
          onClick={onClose}
          title="Close search"
        >
          Close
        </button>
      </div>
    );
  }

  _handleKeyDown = (event) => {
    const { onNext, onPrev, onClose } = this.props;

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
}

export default SearchBar;
