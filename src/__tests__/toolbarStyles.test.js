import fs from 'fs';
import path from 'path';

const readComponentCss = fileName => fs.readFileSync(
  path.join(__dirname, `../components/${fileName}`),
  'utf8'
);

const toolbarCss = readComponentCss('Toolbar.css');
const auditDownloadCss = readComponentCss('AuditReportDownload.css');
const settingsCss = readComponentCss('SettingsPopover.css');

const ruleBody = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

test('toolbar uses responsive rows instead of clipping live controls', () => {
  expect(ruleBody(toolbarCss, '.toolbar-main')).toMatch(/overflow:\s*visible/);
  expect(ruleBody(toolbarCss, '.toolbar-actions')).toMatch(/margin-left:\s*auto/);
  expect(toolbarCss).toMatch(
    /@media \(max-width: 560px\)[\s\S]*?\.toolbar-shadow\s*\{[^}]*height:\s*auto[^}]*flex-wrap:\s*wrap/
  );
  expect(toolbarCss).toMatch(
    /@media \(max-width: 440px\)[\s\S]*?\.toolbar-connection\s*\{[^}]*flex:\s*1 0 100%[^}]*border-top:\s*1px solid var\(--divider-color\)/
  );
});

test('toolbar dividers share one color and hairline rendering method', () => {
  expect(ruleBody(toolbarCss, '.toolbar')).toMatch(/border-bottom:\s*1px solid var\(--divider-color\)/);
  const dividerRule = ruleBody(toolbarCss, '.toolbar-divider');
  expect(dividerRule).toMatch(/width:\s*0/);
  expect(dividerRule).toMatch(/border-left:\s*1px solid var\(--divider-color\)/);
});

test('compact audit button overrides desktop padding at equal specificity', () => {
  expect(auditDownloadCss).toMatch(
    /@media \(max-width: 700px\)[\s\S]*?\.toolbar-item\.audit-report-button\s*\{[^}]*width:\s*29px[^}]*min-width:\s*29px[^}]*padding:\s*0[^}]*gap:\s*0/
  );
});

test('top-bar metadata yields before functional controls', () => {
  expect(settingsCss).toMatch(
    /@media \(max-width: 700px\)[\s\S]*?\.settings-version-label\s*\{[^}]*display:\s*none/
  );
});

test('toolbar checkboxes retain a visible keyboard focus treatment', () => {
  expect(toolbarCss).not.toMatch(/(^|\n)\s*:focus\s*\{[^}]*outline-width:\s*0/m);
  const focusRule = ruleBody(toolbarCss, '.toolbar-item.checkbox input:focus-visible');
  expect(focusRule).toMatch(/outline-offset:\s*1px/);
  expect(toolbarCss).toMatch(
    /\.toolbar-item\.checkbox input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-outline-color\)/
  );
});

test('toolbar spacing and reconnect typography are explicit', () => {
  const checkboxRule = ruleBody(toolbarCss, '.toolbar-item.checkbox');
  const checkboxInputRule = ruleBody(toolbarCss, '.toolbar-item.checkbox input');
  const reconnectRule = ruleBody(toolbarCss, '.reconnect-button');
  const statusRule = ruleBody(toolbarCss, '.connection-status');

  expect(checkboxRule).toMatch(/gap:\s*4px/);
  expect(checkboxRule).toMatch(/padding:\s*0 6px/);
  expect(checkboxInputRule).toMatch(/margin:\s*0/);
  expect(statusRule).toMatch(/gap:\s*4px/);
  expect(statusRule).toMatch(/padding:\s*0 6px/);
  expect(reconnectRule).toMatch(/margin-left:\s*2px/);
  expect(reconnectRule).toMatch(/font:\s*inherit/);
  expect(reconnectRule).toMatch(/font-size:\s*11px/);
  expect(reconnectRule).toMatch(/line-height:\s*1/);
  expect(reconnectRule).not.toMatch(/fontSize/);
});
