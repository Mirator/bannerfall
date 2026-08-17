export function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', error => {
    errors.push('pageerror: ' + (error && error.stack ? error.stack : String(error)));
  });
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console.error: ' + message.text());
  });
  return errors;
}
