var assert = require("assert");
var path = require("path");
var fs = require("graceful-fs");
var spawn = require("child_process").spawn;
var Q = require("q");
var EventEmitter = require("events").EventEmitter;
var inherits = require("util").inherits;
var util = require("./util");
var hasOwn = Object.prototype.hasOwnProperty;

function Watcher(sourceDir, persistent) {
    var self = this;
    assert.ok(self instanceof Watcher);
    assert.ok(self instanceof EventEmitter);

    EventEmitter.call(this);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        sourceCache: { value: {} },
        dirWatcher: { value: new DirWatcher(sourceDir, persistent) }
    });

    function handle(event, relativePath) {
        if (self.dirWatcher.ready) {
            self.getFileHandler(relativePath)(event);
        }
    }

    self.dirWatcher.on("added", function(relativePath) {
        handle("added", relativePath);
    }).on("deleted", function(relativePath) {
        handle("deleted", relativePath);
    }).on("changed", function(relativePath) {
        handle("changed", relativePath);
    });
}

inherits(Watcher, EventEmitter);
var Wp = Watcher.prototype;

Wp.watch = function(relativePath) {
    this.dirWatcher.add(path.dirname(path.join(
        this.sourceDir, relativePath)));
};

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

Wp.getFileHandler = util.cachedMethod(function(relativePath) {
    var self = this;
    return function handler(event) {
        Q.all([
            self.readFileP(relativePath).catch(orNull),
            self.noCacheReadFileP(relativePath).catch(orNull)
        ]).spread(function(oldData, newData) {
            if (oldData !== newData)
                self.emit("changed", relativePath);
        }).done();
    };
});

function orNull(err) {
    return null;
}

Wp.close = function() {
    this.dirWatcher.close();
};

/**
 * DirWatcher code adapted from Jeffrey Lin's original implementation:
 * https://github.com/jeffreylin/jsx_transformer_fun/blob/master/dirWatcher.js
 *
 * Invariant: this only watches the dir inode, not the actual path.
 * That means the dir can't be renamed and swapped with another dir.
 */
function DirWatcher(inputPath, persistent) {
    assert.ok(this instanceof DirWatcher);

    var self = this;
    var absPath = path.resolve(inputPath);

    if (!fs.statSync(absPath).isDirectory()) {
        throw new Error(inputPath + "is not a directory!");
    }

    EventEmitter.call(self);

    self.ready = false;
    self.on("ready", function(){
        self.ready = true;
    });

    Object.defineProperties(self, {
        // Map of absDirPaths to fs.FSWatcher objects from fs.watch().
        watchers: { value: {} },
        dirContents: { value: {} },
        rootPath: { value: absPath },
        persistent: { value: !!persistent }
    });

    process.nextTick(function() {
        self.add(absPath);
        self.emit("ready");
    });
}

util.inherits(DirWatcher, EventEmitter);
var DWp = DirWatcher.prototype;

DWp.add = function(absDirPath) {
    var self = this;
    if (hasOwn.call(self.watchers, absDirPath)) {
        return;
    }

    self.watchers[absDirPath] = fs.watch(absDirPath, {
        persistent: self.persistent
    }).on("change", function(event, filename) {
        self.updateDirContents(absDirPath, event, filename);
    });

    // Update internal dir contents.
    self.updateDirContents(absDirPath);

    // Since we've never seen this path before, recursively add child
    // directories of this path.  TODO: Don't do fs.readdirSync on the
    // same dir twice in a row.  We already do an fs.statSync in
    // this.updateDirContents() and we're just going to do another one
    // here...
    fs.readdirSync(absDirPath).forEach(function(filename) {
        var filepath = path.join(absDirPath, filename);

        // Look for directories.
        if (fs.statSync(filepath).isDirectory()) {
            self.add(filepath);
        }
    });
};

DWp.updateDirContents = function(absDirPath, event, fsWatchReportedFilename) {
    var self = this;

    if (!hasOwn.call(self.dirContents, absDirPath)) {
        self.dirContents[absDirPath] = [];
    }

    var oldContents = self.dirContents[absDirPath];
    var newContents = fs.readdirSync(absDirPath);

    var deleted = {};
    var added = {};

    oldContents.forEach(function(filename) {
        deleted[filename] = true;
    });

    newContents.forEach(function(filename) {
        if (hasOwn.call(deleted, filename)) {
            delete deleted[filename];
        } else {
            added[filename] = true;
        }
    });

    var deletedNames = Object.keys(deleted);
    deletedNames.forEach(function(filename) {
        self.emit(
            "deleted",
            path.relative(
                self.rootPath,
                path.join(absDirPath, filename)
            )
        );
    });

    var addedNames = Object.keys(added);
    addedNames.forEach(function(filename) {
        self.emit(
            "added",
            path.relative(
                self.rootPath,
                path.join(absDirPath, filename)
            )
        );
    });

    // So changed is not deleted or added?
    if (fsWatchReportedFilename &&
        !hasOwn.call(deleted, fsWatchReportedFilename) &&
        !hasOwn.call(added, fsWatchReportedFilename))
    {
        self.emit(
            "changed",
            path.relative(
                self.rootPath,
                path.join(absDirPath, fsWatchReportedFilename)
            )
        );
    }

    // If any of the things removed were directories, remove their watchers.
    // If a dir was moved, hopefully two changed events fired?
    //  1) event in dir where it was removed
    //  2) event in dir where it was moved to (added)
    deletedNames.forEach(function(filename) {
        var filepath = path.join(absDirPath, filename);
        delete self.dirContents[filepath];
        delete self.watchers[filepath];
    });

    // if any of the things added were directories, recursively deal with them
    addedNames.forEach(function(filename) {
        var filepath = path.join(absDirPath, filename);
        if (fs.existsSync(filepath) &&
            fs.statSync(filepath).isDirectory())
        {
            self.add(filepath);
            // mighttttttt need a self.updateDirContents() here in case
            // we're somehow adding a path that replaces another one...?
        }
    });

    // Update state of internal dir contents.
    self.dirContents[absDirPath] = newContents;
};

DWp.close = function() {
    var watchers = this.watchers;
    Object.keys(watchers).forEach(function(filename) {
        watchers[filename].close();
    });
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
