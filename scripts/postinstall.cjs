const { execSync } = require('child_process');

if (process.env.SKIP_HAPPY_WIRE_BUILD === '1') {
  console.log('[postinstall] SKIP_HAPPY_WIRE_BUILD=1, skipping @kmmao/happy-wire build');
  process.exit(0);
}

execSync('yarn workspace @kmmao/happy-wire build', {
  stdio: 'inherit',
});
