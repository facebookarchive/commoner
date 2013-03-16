var assert = require("assert");
var path = require("path");
var fs = require("fs");
var spawn = require("child_process").spawn;
var Q = require("q");
var EventEmitter = require("events").EventEmitter;
var inherits = require("util").inherits;
var util = require("./util");

function Watcher(sourceDir, persistent) {
    var self = this;
    assert.ok(self instanceof Watcher);
    assert.ok(self instanceof EventEmitter);

    EventEmitter.call(this);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        sourceCache: { value: {} },
        watched: { value: {} },
        persistent: { value: !!persistent }
    });
}

inherits(Watcher, EventEmitter);
var Wp = Watcher.prototype;

Wp.readFileP = function(relativePath) {
    relativePath = path.normalize(relativePath);

    var cache = this.sourceCache;
    if (cache.hasOwnProperty(relativePath))
        return cache[relativePath];

    return cache[relativePath] = this.noCacheReadFileP(relativePath);
};

Wp.noCacheReadFileP = function(relativePath) {
    relativePath = path.normalize(relativePath);

    var deferred = Q.defer();
    var promise = deferred.promise;
    var fullPath = path.join(this.sourceDir, relativePath);

    fs.readFile(fullPath, "utf8", function(err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(data);
        }
    });

    this.sourceCache[relativePath] = promise;
    this.watch(relativePath);

    return promise;
};

Wp.watch = function(relativePath) {
    var self = this;
    var watched = self.watched;

    relativePath = path.normalize(relativePath);
    if (!watched.hasOwnProperty(relativePath)) {
        var fullPath = path.join(self.sourceDir, relativePath);
        var options = { persistent: self.persistent };

        function handler(event) {
            var oldP = self.readFileP(relativePath);
            var newP = self.noCacheReadFileP(relativePath);

            Q.all([oldP, newP]).spread(function(oldData, newData) {
                if (oldData !== newData)
                    self.emit("changed", relativePath);
            }).done();
        }

        try {
            fs.watch(fullPath, options, handler);
            // Don't mark the file as watched if fs.watch threw an exception.
            watched[relativePath] = true;
        } catch (e) {
            util.log.err(
                "unable to watch file " + relativePath +
                " (" + e + ")",
                "yellow");
        }
    }
};

function run(cmd, args) {
    return spawn(cmd, args, {
        stdio: "pipe",
        env: process.env
    });
}

var grepExtensionDef = Q.defer();
var grepExtensionP = grepExtensionDef.promise;

run("grep", [
    "--quiet",
    "--perl-regexp",
    "spawn",
    __filename
]).on("close", function(code) {
    if (code === 0 || code === 1) {
        grepExtensionDef.resolve("--perl-regexp");
    } else {
        grepExtensionDef.resolve("--extended-regexp");
    }
});

Wp.grepP = function(pattern) {
    var watcher = this;
    return grepExtensionP.then(function(extension) {
        return grepP.call(watcher, pattern, extension);
    });
};

function grepP(pattern, grepExtension) {
    var self = this;
    var sourceDir = self.sourceDir;

    var grep = run("grep", [
        "--recursive",
        "--only-matching",
        "--null", // separate file from match with \0 instead of :
        "--max-count=1",
        grepExtension,
        pattern,
        sourceDir
    ]);

    var outs = [];
    var errs = [];
    var closed = false;

    grep.stdout.on("data", function(data) {
        assert.ok(!closed);
        outs.push(data);
    });

    grep.stderr.on("data", function(data) {
        assert.ok(!closed);
        errs.push(data);
    });

    var deferred = Q.defer();
    var promise = deferred.promise;

    grep.on("close", function(code) {
        assert.ok(!closed);
        closed = true;

        switch (code) {
        case 0: case 1: // 1 means no results
            if (errs.length === 0) {
                deferred.resolve(outs.join(""));
                break;
            }
            // intentionally fall through
        default:
            deferred.reject(errs.join(""));
        }
    });

    return promise.then(function(out) {
        var pathToMatch = {};

        out.split("\n").forEach(function(line) {
            if ((line = line.trim())) {
                var splat = line.split("\0"); // see --null above
                var relPath = path.relative(sourceDir, splat.shift());
                pathToMatch[relPath] = splat.join("\0");

                // TODO Watch the whole directory tree to catch new files
                // that match the grepped-for pattern.
                self.watch(relPath);
            }
        });

        return pathToMatch;
    });
};

exports.Watcher = Watcher;
