// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React from 'react';
import './MethodHeader.css';

const MethodHeader = ({ method }) => {
  if (!method) {
    return null;
  }

  return (
    <div className="method-header">
      <span className="method-header-text">{method}</span>
    </div>
  );
};

export default MethodHeader;
