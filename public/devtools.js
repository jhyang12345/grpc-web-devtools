const panelTitle = chrome.i18n?.getMessage('devtoolsPanelTitle') || 'gRPC Inspector';
chrome.devtools.panels.create(panelTitle, '', 'index.html');
