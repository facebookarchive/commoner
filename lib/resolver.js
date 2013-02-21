var assert = require("assert");
var fs = require("fs");
var path = require("path");
var Q = require("q");
var spawn = require("child_process").spawn;

function Resolver(sourceDir) {
    var self = this;
    assert.ok(self instanceof Resolver);

    var directive = "providesModule";
    var providesP = findP(directive, sourceDir).then(function(results) {
        var idToPath = {};
        var pathToId = {};

        results.split("\n").forEach(function(line) {
            if ((line = line.trim())) {
                var splat = line.split(":@");
                var file = path.normalize(splat[0]);
                splat = splat[1].split(/\s+/);
                assert.strictEqual(splat[0], directive);
                var id = splat[1];

                var message = "duplicate @" + directive + ": " + id;

                if (idToPath.hasOwnProperty(id))
                    assert.strictEqual(idToPath[id], file, message);

                if (pathToId.hasOwnProperty(file))
                    assert.strictEqual(pathToId[file], id, message);

                idToPath[id] = file;
                pathToId[file] = id;
            }
        });

        return {
            idToPath: idToPath,
            pathToId: pathToId
        };
    });

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        providesP: { value: providesP }
    });
}

Resolver.prototype = {
    resolveP: function(id) {
        return Q.all([
            this.providesP,
            fsLookupP(path.join(this.sourceDir, id + ".js"))
        ]).spread(function(provides, fsPath) {
            if (provides.idToPath.hasOwnProperty(id))
                return { id: id, path: provides.idToPath[id] };

            if (fsPath) {
                fsPath = path.normalize(fsPath);

                if (provides.pathToId.hasOwnProperty(fsPath))
                    return { id: provides.pathToId[fsPath], path: fsPath };

                return { id: id, path: fsPath };
            }

            return null;
        });
    }
};

exports.Resolver = Resolver;

function fsLookupP(file) {
    var deferred = Q.defer();
    var promise = deferred.promise;

    fs.exists(file, function(exists) {
        if (exists) {
            deferred.resolve(path.normalize(file));
        } else {
            deferred.resolve(null);
        }
    });

    return promise;
}

function run(cmd, args) {
    return spawn(cmd, args, {
        stdio: "pipe",
        env: process.env
    });
}

function findP(directive, sourceDir) {
    var find = run("find", [sourceDir]);
    var grep = run("grep", ["\.js$"]);
    var xargs = run("xargs", [
        "grep",
        "-o", // Only print matched part of line.
        "--max-count=1", // Only respect first match per file.
        "@" + directive + "\\s\\+\\S\\+"
    ]);

    find.stdout.pipe(grep.stdin);
    grep.stdout.pipe(xargs.stdin);

    var outs = [];
    var errs = [];
    xargs.stdout.on("data", outs.push.bind(outs));
    xargs.stderr.on("data", errs.push.bind(errs));

    var deferred = Q.defer();
    var promise = deferred.promise;

    xargs.on("exit", function(code) {
        if (code !== 0) {
            deferred.reject(errs.join(""));
        } else {
            deferred.resolve(outs.join(""));
        }
    });

    return promise;
}
