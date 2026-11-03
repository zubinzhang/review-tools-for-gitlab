const path = require('path');
const Mocha = require('mocha');
const {
  initializeTestEnvironment,
} = require('../integration/test_infrastructure/initialize_test_environment');

async function run() {
  const testsRoot = path.resolve(__dirname, '../integration');
  await initializeTestEnvironment(testsRoot);
  const mocha = new Mocha({ timeout: 15000, color: true });
  mocha.addFile(path.join(__dirname, 'wiring.test.js'));
  mocha.addFile(path.join(testsRoot, 'mr_review.test.js'));
  mocha.addFile(path.join(testsRoot, 'issuable_webview.test.js'));
  mocha.addFile(path.join(__dirname, 'navigation.test.js'));
  await new Promise((resolve, reject) => {
    mocha.run(failures =>
      failures ? reject(new Error(`${failures} Review tests failed`)) : resolve(),
    );
  });
}

module.exports = { run };
