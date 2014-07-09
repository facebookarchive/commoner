var path = require('path');
var Q = require("q");
var fs = require('graceful-fs');
var readdir = Q.denodeify(fs.readdir);
var lstat = Q.denodeify(fs.lstat);
var readFile = Q.denodeify(fs.readFile);

function processDirP(pattern, dir) {
    return readdir(dir).then(function(files) {
        return Q.all(files.map(function(file) {
            file = path.join(dir, file);
            return lstat(file).then(function(stat) {
                return stat.isDirectory() ? processDirP(pattern, file) : processFileP(pattern, file);
            })
        })).then(function(results) {
            return results.reduce(function(a, b) { return a.concat(b) }) // flatten the results
        })
    });
}

function processFileP(pattern, file) {
    return readFile(file).then(function(contents) {
        var result;
        pattern = new RegExp(pattern, 'g');
        if (result = pattern.exec(contents)) {
            return [{
                path: file,
                match: result[0]
            }]
        }
        return [];
    });
}

module.exports = function(pattern, sourceDir) {
    return processDirP(pattern, sourceDir).then(function(results) {
        var pathToMatch = {};

        results.forEach(function(result) {
            var relPath = path.relative(sourceDir, result.path).replace(/\\/g, '/');
            pathToMatch[relPath] = result.match;
        });
        
        return pathToMatch;
    });
};
