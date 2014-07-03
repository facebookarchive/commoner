var whiskey = require("whiskey");

var args = ['node', 'whiskey', '--tests', 'test/run.js'];

if (process.platform === 'win32') {
    args.push('--socket-path', '\\\\.\\pipe\\whiskey-'+(Math.random() * 10000));
}

whiskey.run(process.cwd(), args);
