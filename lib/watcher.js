var assert = require("assert");
var path = require("path");
var fs = require("graceful-fs");
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
    var fullPath = path.join(this.sourceDir, relativePath);
    var promise = util.readFileP(fullPath);
    this.sourceCache[relativePath] = promise;
    this.watch(relativePath);
    return promise;
};

Wp.watch = function(relativePath) {
    var self = this;
    var watched = self.watched;

    if (!self.persistent)
        return;

    relativePath = path.normalize(relativePath);
    if (!watched.hasOwnProperty(relativePath)) {
        var fullPath = path.join(self.sourceDir, relativePath);
        var options = { persistent: self.persistent };

        function handler(event) {
            Q.all([
                self.readFileP(relativePath).catch(orNull),
                self.noCacheReadFileP(relativePath).catch(orNull)
            ]).spread(function(oldData, newData) {
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

function orNull(err) {
    return null;
}

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
        default:
            if (errs.length > 0) {
                util.log.err(errs.join(""));
            }

            // intentionally fall through

        case 0: case 1: // 1 means no results
            deferred.resolve(outs.join(""));
        }
    });

    return promise.then(function(out) {
        var pathToMatch = {};

        out.split("\n").forEach(function(line) {
            if ((line = line.trim())) {
                var splat = line.split("\0"); // see --null above
                var relPath = path.relative(sourceDir, splat.shift());

                // Only record the first match in any particular file.
                if (pathToMatch.hasOwnProperty(relPath))
                    return;

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
