var assert = require("assert");
var path = require("path");
var fs = require("fs");
var spawn = require("child_process").spawn;
var Q = require("q");
var createHash = require("crypto").createHash;
var uglify = require("uglify-js");
var slice = Array.prototype.slice;

function readFileP(file) {
    var deferred = Q.defer();

    fs.readFile(file, "utf8", function(err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(data);
        }
    });

    return deferred.promise;
}
exports.readFileP = readFileP;

exports.readJsonFileP = function(file) {
    return readFileP(file).then(function(json) {
        return JSON.parse(json);
    });
};

exports.mkdirP = function(dir) {
    var deferred = Q.defer();

    function finish(err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(dir);
        }
    }

    fs.stat(dir, function(err, stats) {
        if (err) {
            if (err.code == "ENOENT") {
                fs.mkdir(dir, finish);
            } else {
                finish(err);
            }
        } else if (stats.isDirectory()) {
            finish();
        } else {
            finish(dir + " is not a directory");
        }
    });

    return deferred.promise;
};

exports.readJsonFromStdinP = function() {
    var deferred = Q.defer();
    var stdin = process.stdin;
    var ins = [];

    stdin.resume();
    stdin.setEncoding("utf8");

    stdin.on("data", function(data) {
        ins.push(data);
    }).on("end", function() {
        deferred.resolve(JSON.parse(ins.join("")));
    });

    return deferred.promise;
};

function deepHash(val) {
    var hash = createHash("sha1");
    var type = typeof val;

    if (val === null) {
        type = "null";
    }

    switch (type) {
    case "object":
        Object.keys(val).sort().forEach(function(key) {
            hash.update(key + "\0")
                .update(deepHash(val[key]));
        });
        break;

    case "function":
        assert.ok(false, "cannot hash function objects");
        break;

    default:
        hash.update(val + "");
        break;
    }

    return hash.digest("hex");
}
exports.deepHash = deepHash;

exports.existsP = function(fullPath) {
    var deferred = Q.defer();

    fs.exists(fullPath, function(exists) {
        deferred.resolve(exists);
    });

    return deferred.promise;
};

exports.writeP = function(fullPath, source) {
    var deferred = Q.defer();

    fs.writeFile(fullPath, source, function(err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(source);
        }
    });

    return deferred.promise;
};

function run(cmd, args) {
    return spawn(cmd, args, {
        stdio: "pipe",
        env: process.env
    });
}

exports.findDirectiveP = function(directive, sourceDir) {
    var grep = run("grep", [
        "--recursive",
        "--only-matching",
        "--max-count=1",
        "@" + directive + "\\s\\+\\S\\+",
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
        var pathToValue = {};

        out.split("\n").forEach(function(line) {
            if ((line = line.trim())) {
                var splat = line.split(":@");
                var relPath = path.relative(sourceDir, splat[0]);
                var value = splat[1].split(/\s+/).pop();
                pathToValue[relPath] = value;
            }
        });

        return pathToValue;
    });
};

exports.minify = function(code) {
    var options = {
        fromString: true
    };

    var untouchables = slice.call(arguments, 1);
    if (untouchables.length > 0) {
        options.mangle = { except: untouchables };
    }

    return uglify.minify(code, options).code;
};
