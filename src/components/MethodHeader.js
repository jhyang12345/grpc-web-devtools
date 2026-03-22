// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React from 'react';
import './MethodHeader.css';

function formatMethodLabel(method) {
  const rawMethod = String(method);
  let normalizedMethod = rawMethod;

  if (rawMethod.startsWith("http://") || rawMethod.startsWith("https://")) {
    try {
      normalizedMethod = new URL(rawMethod).pathname;
    } catch (error) {
      normalizedMethod = rawMethod;
    }
  }

  const parts = normalizedMethod.split('/');
  if (parts.length < 3) {
    return normalizedMethod || method;
  }

  const serviceName = parts[1].split('.').pop();
  const methodName = parts[2];

  if (!serviceName || !methodName) {
    return normalizedMethod || method;
  }

  return `${serviceName}/${methodName}`;
}

const MethodHeader = ({ method }) => {
  if (!method) {
    return null;
  }

  return (
    <div className="method-header">
      <span className="method-header-text">{formatMethodLabel(method)}</span>
    </div>
  );
};

export default MethodHeader;
