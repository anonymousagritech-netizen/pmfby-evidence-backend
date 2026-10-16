// Renders a message_templates.body_template ({Variable} placeholders) against a data
// object. Missing variables render as an empty string rather than throwing, but the
// render() result also reports which variables were missing so routes can warn the admin.
function renderTemplate(bodyTemplate, data) {
  const missing = [];
  const rendered = bodyTemplate.replace(/\{([A-Za-z0-9_]+)\}/g, (match, varName) => {
    if (data[varName] === undefined || data[varName] === null || data[varName] === '') {
      missing.push(varName);
      return '';
    }
    return String(data[varName]);
  });
  return { rendered, missing };
}

module.exports = { renderTemplate };
