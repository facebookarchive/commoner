var assert = require("assert");
var path = require("path");
var Q = require("q");
var util = require("./util");
var spawn = require("child_process").spawn;

function BuildContext(config, sourceDir, outputDir) {
    var self = this;
    assert.ok(self instanceof BuildContext);
    assert.strictEqual(typeof sourceDir, "string");
    assert.strictEqual(typeof outputDir, "string");

    config = config || {};
    Object.freeze(config);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        outputDir: { value: outputDir },
        config: { value: config },
        configHash: { value: util.deepHash(config) }
    });
}

var BCp = BuildContext.prototype;

BCp.defer = function() {
    return Q.defer();
};

BCp.spawnP = function(command, args, kwargs) {
    args = args || [];
    kwargs = kwargs || {};

    var deferred = Q.defer();

    var outs = [];
    var errs = [];

    var options = {
        stdio: "pipe",
        env: process.env
    };

    if (kwargs.cwd) {
        options.cwd = kwargs.cwd;
    }

    var child = spawn(command, args, options);

    child.stdout.on("data", function(data) {
        outs.push(data);
    });

    child.stderr.on("data", function(data) {
        errs.push(data);
    });

    child.on("close", function(code) {
        if (errs.length > 0 || code !== 0) {
            var err = {
                code: code,
                text: errs.join("")
            };
        }

        deferred.resolve([err, outs.join("")]);
    });

    var stdin = kwargs && kwargs.stdin;
    if (stdin) {
        child.stdin.end(stdin);
    }

    return deferred.promise;
};

BCp.readFileP = util.cachedMethod(function(file) {
    return util.readFileP(path.join(this.sourceDir, file));
});

BCp.getProvidedP = util.cachedMethod(function() {
    return util.findDirectiveP(
        "providesModule",
        this.sourceDir
    ).then(function(pathToValue) {
        var valueToPath = {};
        Object.keys(pathToValue).sort().forEach(function(path) {
            valueToPath[pathToValue[path]] = path;
        });
        return valueToPath;
    });
});

exports.BuildContext = BuildContext;
