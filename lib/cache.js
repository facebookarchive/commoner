var assert = require("assert");
var Q = require("q");
var fs = require("fs");
var path = require("path");
var util = require("./util");
var EventEmitter = require("events").EventEmitter;
var hasOwn = Object.prototype.hasOwnProperty;


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


function ReadFileCache(sourceDir) {
    assert.ok(this instanceof ReadFileCache);

    EventEmitter.call(this);

    Object.defineProperties(this, {
        sourceDir: { value: sourceDir },
        sourceCache: { value: {} }
    });
}

util.inherits(ReadFileCache, EventEmitter);
var RFCp = ReadFileCache.prototype;

RFCp.readFileP = function(relativePath) {
    var cache = this.sourceCache;

    relativePath = path.normalize(relativePath);

    return hasOwn.call(cache, relativePath)
        ? cache[relativePath]
        : this.noCacheReadFileP(relativePath);
};

RFCp.noCacheReadFileP = function(relativePath) {
    relativePath = path.normalize(relativePath);

    var added = !hasOwn.call(this.sourceCache, relativePath);
    var promise = this.sourceCache[relativePath] = util.readFileP(
        path.join(this.sourceDir, relativePath));

    if (added) {
        this.emit("added", relativePath);
    }

    return promise;
};

RFCp.reportPossiblyChanged = function(relativePath) {
    var self = this;
    var cached = self.readFileP(relativePath);
    var fresh = self.noCacheReadFileP(relativePath);

    Q.all([
        cached.catch(orNull),
        fresh.catch(orNull)
    ]).spread(function(oldData, newData) {
        if (oldData !== newData) {
            self.emit("changed", relativePath);
        }
    }).done();
};

RFCp.subscribe = function(callback, context) {
    for (var relativePath in this.sourceCache) {
        if (hasOwn.call(this.sourceCache, relativePath)) {
            callback.call(context || null, relativePath);
        }
    }

    this.on("added", function(relativePath) {
        callback.call(context || null, relativePath);
    });
};

RFCp.clear = function() {
    this.removeAllListeners();

    for (var relativePath in this.sourceCache) {
        delete this.sourceCache[relativePath];
    }
};

function orNull(err) {
    return null;
}

exports.ReadFileCache = ReadFileCache;
