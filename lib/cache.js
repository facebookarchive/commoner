var assert = require("assert");
var Q = require("q");
var fs = require("fs");
var path = require("path");
var util = require("./util");
var env = process.env;
var home = env.HOME || env.HOMEPATH || env.USERHOME;
var defaultDir = path.join(home, ".commoner", "module-cache");

function DiskCache(dir) {
    var self = this;
    assert.ok(self instanceof DiskCache);

    Object.defineProperties(self, {
        cacheDirP: { value: util.mkdirP(dir || defaultDir) }
    });
}

var DCp = DiskCache.prototype;

DCp.setDefaultP = util.cachedMethod(function(key, toStringP, fromStringP) {
    return this.cacheDirP.then(function(cacheDir) {
        var file = path.join(cacheDir, key + ".js");
        return util.openExclusiveP(file).then(function(fd) {
            var stringP = Q.resolve(toStringP());
            return stringP.then(function(string) {
                return util.writeFdP(fd, string);
            });
        }, function(err) {
            assert.strictEqual(err.code, "EEXIST"); // TODO
            // TODO Deal with inter-process race condition!
            return util.readFileP(file);
        });
    }).then(fromStringP);
}, function(key, toStringP, fromStringP) {
    return key;
});

// TODO If the new file is not on the same device as the cache file, just
// make a copy.
DCp.linkP = function(key, file) {
    return Q.all([
        this.cacheDirP,
        util.mkdirP(path.dirname(file))
    ]).spread(function(cacheDir) {
        return util.linkP(
            path.join(cacheDir, key + ".js"),
            file
        );
    });
};

exports.DiskCache = DiskCache;
