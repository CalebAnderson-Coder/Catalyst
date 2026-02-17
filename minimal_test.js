console.log('ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Process Type:', process.type); // Should be 'browser'
try {
    // Try to bypass require cache or lookups? No, just standard check
    console.log('Require resolve electron:', require.resolve('electron'));
} catch (e) { }

// FORCE load internal module?
try {
    const internal = process.electronBinding('app'); // Internal binding?
    console.log('Internal binding app?', !!internal);
} catch (e) { console.log('No process.electronBinding'); }
