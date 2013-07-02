var assert = require("assert");
var Q = require("q");
var fs = require("fs");
var path = require("path");
var util = require("./util");

function DiskCache(cacheDirP) {
    var self = this;
    assert.ok(self instanceof DiskCache);

    Object.defineProperties(self, {
        cacheDirP: { value: cacheDirP }
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

DCp.linkP = function(key, file) {
    return Q.all([
        this.cacheDirP,
        util.mkdirP(path.dirname(file))
    ]).spread(function(cacheDir) {
        var cacheFile = path.join(cacheDir, key + ".js");
        return util.linkP(
            cacheFile, file
        ).catch(function(err) {
            // If the new file is not on the same device as the cache
            // file, just make a copy.
            return util.copyP(cacheFile, file);
        });
    });
};

exports.DiskCache = DiskCache;

function ProcessCache() {
    assert.ok(this instanceof ProcessCache);
}

var PCp = ProcessCache.prototype;

PCp.setDefaultP = util.cachedMethod(function(key, toStringP, fromStringP) {
    var stringP = Q.resolve(toStringP());
    return stringP.then(function(string) {
        return fromStringP(string);
    });
}, function(key, toStringP, fromStringP) {
    return key;
});

PCp.linkP = function(key, file) {
    return Q.all([
        util.mkdirP(path.dirname(file)),
        this.setDefaultP(
            key,
            coldCacheError, // It's a mistake to call .linkP before
            coldCacheError  // calling .setDefaultP.
        )
    ]).spread(function(dir, module) {
        return util.openExclusiveP(file).then(function(fd) {
            return util.writeFdP(fd, module.source);
        });
    });
};

function coldCacheError() {
    throw new Error("must call .setDefaultP before calling .linkP");
}

exports.ProcessCache = ProcessCache;
