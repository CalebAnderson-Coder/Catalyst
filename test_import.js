console.log('Process versions:', process.versions);
try {
    console.log('Resolved electron path:', require.resolve('electron'));
} catch (e) { console.log('Resolve error:', e.message); }

const electron = require('electron');
console.log('Type of electron symbol:', typeof electron);
if (typeof electron === 'string') {
    console.log('Electron export value:', electron);
}
console.log('Has app?', !!electron.app);
