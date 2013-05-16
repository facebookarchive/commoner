var assert = require("assert");
var Q = require("q");
var util = require("./util");
var spawn = require("child_process").spawn;
var Watcher = require("./watcher").Watcher;

function BuildContext(config, watcher, outputDir) {
    var self = this;
    assert.ok(self instanceof BuildContext);
    assert.ok(watcher instanceof Watcher);
    assert.strictEqual(typeof outputDir, "string");

    config = config || {};
    Object.freeze(config);

    Object.defineProperties(self, {
        watcher: { value: watcher },
        outputDir: { value: outputDir },
        config: { value: config },
        configHash: { value: util.deepHash(config) }
    });
}

var BCp = BuildContext.prototype;

BCp.makePromise = function(callback, context) {
    return util.makePromise(callback, context);
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

BCp.setPreferredFileExtension = function(ext) {
    assert.strictEqual(typeof ext, "string");
    Object.defineProperty(this, "preferredFileExtension", {
        value: ext.toLowerCase()
    });
};

// This default can be overridden by individual BuildContext instances.
BCp.setPreferredFileExtension("js");

BCp.hasPreferredFileExtension = function(file) {
    return file.split(".").pop().toLowerCase() ===
        this.preferredFileExtension;
};

BCp.readModuleP = function(id) {
    return this.watcher.readFileP(
        id + "." + this.preferredFileExtension
    );
};

BCp.readFileP = function(file) {
    return this.watcher.readFileP(file);
};

BCp.getProvidedP = util.cachedMethod(function() {
    var context = this;
    var pattern = "@providesModule\\s+\\S+";
    return context.watcher.grepP(pattern).then(function(pathToMatch) {
        var idToPath = {};
        Object.keys(pathToMatch).sort().forEach(function(path) {
            var id = pathToMatch[path].split(/\s+/).pop();
            // If we're about to overwrite an existing module identifier,
            // make sure the corresponding path ends with the preferred
            // file extension. This allows @providesModule directives in
            // .coffee files, for example, but prevents .js~ temporary
            // files from taking precedence over actual .js files.
            if (!idToPath.hasOwnProperty(id) ||
                context.hasPreferredFileExtension(path))
                idToPath[id] = path;
        });
        return idToPath;
    });
});

exports.BuildContext = BuildContext;
